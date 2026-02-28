from __future__ import annotations

import asyncio
import os
import re
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

import torch
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from ultralytics import YOLO
from dotenv import load_dotenv

from models_db import (
    Camera,
    EmailConfig,
    EmailDeliveryLog,
    SessionLocal,
    SmsConfig,
    SmsDeliveryLog,
    User,
    Violation,
)
from notifications import send_smtp_email, send_twilio_sms
from schemas import AlarmResponse, InferResponse
from workers import InferenceWorker

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))


SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
ALGORITHM = "HS256"
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
FALL_CLASS = os.getenv("FALL_CLASS", "Fall-Detected")
MAX_METADATA_STALENESS_SEC = float(os.getenv("MAX_METADATA_STALENESS_SEC", "1.0"))
REQUIRE_WS_AUTH = os.getenv("REQUIRE_WS_AUTH", "true").strip().lower() in {"1", "true", "yes"}

app = FastAPI(title="PPE + Fall Detection API")
security = HTTPBearer()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# GPU is mandatory for this architecture.
if not torch.cuda.is_available():
    raise RuntimeError("GPU inference is mandatory. CUDA device not available.")

model_ppe = YOLO(os.getenv("PPE_MODEL_PATH", "best.pt"))
model_fall = YOLO(os.getenv("FALL_MODEL_PATH", "last.pt"))
model_ppe.to("cuda")
model_fall.to("cuda")
try:
    model_ppe.model.half()
    model_fall.model.half()
except Exception:
    pass


workers: dict[str, InferenceWorker] = {}
fall_detected_store: dict[str, dict[str, Any]] = {}
ws_connect_count: dict[str, int] = {}
CAMERA_MODES = {"upload", "live"}
FALL_CLEAR_REQUIRED_FRAMES = 2
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_alarm_state() -> dict[str, Any]:
    return {
        "detected": False,
        "timestamp": None,
        "acknowledged": False,
        "last_alerted": None,
        "active": False,
        "clear_frames": 0,
        "incident": 0,
    }


def update_alarm_state(cam_id: str, fall_detected: bool, timestamp: str) -> bool:
    new_incident = False
    state = fall_detected_store.setdefault(cam_id, default_alarm_state())

    if fall_detected:
        state["clear_frames"] = 0

        # New incident starts on a rising edge.
        if not state.get("active", False):
            state["active"] = True
            state["acknowledged"] = False
            state["detected"] = True
            state["timestamp"] = timestamp
            state["last_alerted"] = timestamp
            state["incident"] = int(state.get("incident", 0)) + 1
            new_incident = True
        elif not state.get("acknowledged", False):
            state["detected"] = True
    else:
        clear_frames = int(state.get("clear_frames", 0)) + 1
        state["clear_frames"] = clear_frames
        if clear_frames >= FALL_CLEAR_REQUIRED_FRAMES:
            state["active"] = False
            state["detected"] = False
            state["acknowledged"] = False
    return new_incident


def get_sms_config(db: Session) -> SmsConfig | None:
    return db.query(SmsConfig).order_by(SmsConfig.id.asc()).first()


def get_email_config(db: Session) -> EmailConfig | None:
    return db.query(EmailConfig).order_by(EmailConfig.id.asc()).first()


def send_fall_sms_async(cam_id: str, timestamp: str) -> None:
    db = SessionLocal()
    try:
        cfg = get_sms_config(db)
        if not cfg or not cfg.enabled:
            return
        sender = env_sms_sender()
        receiver = (cfg.receiver_number or "").strip()
        if not sender or not receiver:
            return
        if not E164_RE.fullmatch(sender) or not E164_RE.fullmatch(receiver):
            return
    finally:
        db.close()

    body = f"[PPE Alert] Fall detected on {cam_id} at {timestamp}. Please check immediately."

    def _send() -> None:
        ok, detail, data = send_twilio_sms(sender, receiver, body)
        db2 = SessionLocal()
        try:
            db2.add(
                SmsDeliveryLog(
                    camera_id=cam_id,
                    to_number=receiver,
                    message=body,
                    status="success" if ok else "failed",
                    detail=detail,
                    provider_id=str((data or {}).get("sid", "")),
                    is_test=False,
                )
            )
            db2.commit()
        finally:
            db2.close()

    threading.Thread(target=_send, daemon=True).start()


def send_fall_email_async(cam_id: str, timestamp: str) -> None:
    db = SessionLocal()
    try:
        cfg = get_email_config(db)
        if not cfg or not cfg.enabled:
            return
        sender = env_email_sender()
        receiver = (cfg.receiver_email or "").strip()
        if not sender or not receiver:
            return
    finally:
        db.close()

    subject = f"PPE Alert - Fall detected on {cam_id}"
    body = (
        f"Fall incident detected.\n\n"
        f"Camera: {cam_id}\n"
        f"Timestamp: {timestamp}\n\n"
        f"Please acknowledge and review immediately."
    )

    def _send() -> None:
        ok, detail, _ = send_smtp_email(sender, receiver, subject, body)
        db2 = SessionLocal()
        try:
            db2.add(
                EmailDeliveryLog(
                    camera_id=cam_id,
                    to_email=receiver,
                    subject=subject,
                    message=body,
                    status="success" if ok else "failed",
                    detail=detail,
                    is_test=False,
                )
            )
            db2.commit()
        finally:
            db2.close()

    threading.Thread(target=_send, daemon=True).start()


def hash_password(password: str) -> str:
    import hashlib

    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(password: str, hashed: str) -> bool:
    import hashlib

    return hashlib.sha256(password.encode()).hexdigest() == hashed


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
        return username
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


def validate_ws_token(token: str | None) -> str | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except Exception:
        return None


def ensure_camera(db: Session, cam_id: str) -> None:
    cam = db.query(Camera).filter(Camera.name == cam_id).first()
    if cam is None:
        db.add(Camera(name=cam_id))
        db.commit()


def parse_camera_id(camera_id: str) -> tuple[str, str]:
    if "::" not in camera_id:
        return "upload", camera_id

    maybe_mode, raw_name = camera_id.split("::", 1)
    mode = maybe_mode if maybe_mode in CAMERA_MODES else "upload"
    return mode, raw_name


def make_camera_id(name: str, mode: str) -> str:
    safe_mode = mode if mode in CAMERA_MODES else "upload"
    return f"{safe_mode}::{name.strip()}"


def get_worker(cam_id: str) -> InferenceWorker:
    worker = workers.get(cam_id)
    if worker:
        return worker

    worker = InferenceWorker(
        camera_id=cam_id,
        ppe_model=model_ppe,
        fall_model=model_fall,
        fall_class=FALL_CLASS,
        redis_url=REDIS_URL,
    )
    worker.start()
    workers[cam_id] = worker
    ws_connect_count.setdefault(cam_id, 0)
    fall_detected_store.setdefault(cam_id, default_alarm_state())
    return worker


def persist_detections(cam_id: str, dets: list[dict[str, Any]]) -> None:
    if not dets:
        return

    db = SessionLocal()
    try:
        now = datetime.utcnow()
        for det in dets:
            db.add(
                Violation(
                    camera_id=cam_id,
                    label=det["label"],
                    timestamp=now,
                    username=None,
                )
            )
        db.commit()
    finally:
        db.close()


class AuthSchema(BaseModel):
    username: str
    password: str


class SmsConfigSchema(BaseModel):
    receiver_number: str
    enabled: bool = True


class SmsTestSchema(BaseModel):
    message: str | None = None


class EmailConfigSchema(BaseModel):
    receiver_email: str
    enabled: bool = True


class EmailTestSchema(BaseModel):
    subject: str | None = None
    message: str | None = None


def validate_sms_numbers(sender: str, receiver: str) -> None:
    if not E164_RE.fullmatch(sender):
        raise HTTPException(
            status_code=400,
            detail="Sender number must be E.164 format, e.g. +15551234567",
        )
    if not E164_RE.fullmatch(receiver):
        raise HTTPException(
            status_code=400,
            detail="Receiver number must be E.164 format, e.g. +15557654321",
        )


def env_sms_sender() -> str:
    return os.getenv("TWILIO_FROM_NUMBER", "").strip()


def env_email_sender() -> str:
    return os.getenv("SMTP_FROM_EMAIL", "").strip() or os.getenv("SMTP_USER", "").strip()


@app.on_event("shutdown")
def shutdown_workers() -> None:
    for worker in workers.values():
        worker.stop()


@app.post("/signup")
def signup(data: AuthSchema, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="User already exists")

    db.add(User(username=data.username, hashed_password=hash_password(data.password)))
    db.commit()
    return {"message": "User created"}


@app.post("/signin")
def signin(data: AuthSchema, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    expire = datetime.utcnow() + timedelta(hours=2)
    token = jwt.encode({"sub": user.username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)
    return {"access_token": token}


@app.post("/upload")
async def upload_video(
    video: UploadFile = File(...),
    camId: str = Query(..., min_length=1),
    user: str = Depends(get_current_user),
):
    # Upload endpoint now only initializes pipeline metadata state.
    # Video bytes are intentionally not streamed back by backend.
    _ = await video.read()
    db = SessionLocal()
    try:
        ensure_camera(db, camId)
    finally:
        db.close()

    get_worker(camId)
    return {"status": "pipeline-ready", "camId": camId, "timestamp": utc_now_iso()}


@app.post("/start_video")
async def start_video_alias(
    video: UploadFile = File(...),
    camId: str = Query(..., min_length=1),
    user: str = Depends(get_current_user),
):
    return await upload_video(video=video, camId=camId, user=user)


@app.websocket("/ws/infer")
async def ws_infer(ws: WebSocket):
    await ws.accept()

    cam_id = ws.query_params.get("cam") or "default"
    token = ws.query_params.get("token")
    username = validate_ws_token(token)
    if REQUIRE_WS_AUTH and not username:
        await ws.send_json({"error": "unauthorized", "detail": "Invalid or missing token"})
        await ws.close(code=1008)
        return

    worker = get_worker(cam_id)
    ws_connect_count[cam_id] = ws_connect_count.get(cam_id, 0) + 1

    while True:
        try:
            frame_bytes = await ws.receive_bytes()
            seq = worker.submit(frame_bytes)
            metadata = worker.await_result(seq, timeout=2.5)
            if metadata is None:
                latest = worker.latest_metadata()
                if latest is not None:
                    try:
                        ts = latest.get("timestamp")
                        if ts:
                            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                            age = (datetime.now(timezone.utc) - dt).total_seconds()
                        else:
                            age = MAX_METADATA_STALENESS_SEC + 1
                    except Exception:
                        age = MAX_METADATA_STALENESS_SEC + 1

                    if age <= MAX_METADATA_STALENESS_SEC:
                        metadata = latest
                    else:
                        metadata = InferResponse(
                            dets=[],
                            fall_detected=False,
                            timestamp=utc_now_iso(),
                            frame_width=None,
                            frame_height=None,
                        ).model_dump()
                else:
                    metadata = InferResponse(
                        dets=[],
                        fall_detected=False,
                        timestamp=utc_now_iso(),
                        frame_width=None,
                        frame_height=None,
                    ).model_dump()

            to_persist = metadata.get("events") or []
            if to_persist:
                persist_detections(cam_id, to_persist)
            new_incident = update_alarm_state(
                cam_id=cam_id,
                fall_detected=bool(metadata.get("fall_detected")),
                timestamp=metadata.get("timestamp", utc_now_iso()),
            )
            if new_incident:
                send_fall_sms_async(
                    cam_id=cam_id,
                    timestamp=metadata.get("timestamp", utc_now_iso()),
                )
                send_fall_email_async(
                    cam_id=cam_id,
                    timestamp=metadata.get("timestamp", utc_now_iso()),
                )

            await ws.send_json(metadata)
        except WebSocketDisconnect:
            break
        except RuntimeError:
            # Usually indicates socket is closing/closed.
            break
        except Exception as exc:
            print(f"[ws/infer] camera={cam_id} error={type(exc).__name__}: {exc}")
            try:
                await ws.send_json(
                    {
                        "dets": [],
                        "fall_detected": False,
                        "timestamp": utc_now_iso(),
                        "frame_width": None,
                        "frame_height": None,
                        "error": "ws_processing_error",
                    }
                )
            except Exception:
                pass
            await asyncio.sleep(0.01)


@app.get("/camera_metrics")
def camera_metrics(cam: str, user: str = Depends(get_current_user)):
    worker = workers.get(cam)
    if not worker:
        return {
            "camera_id": cam,
            "streaming": False,
            "ws_reconnects": ws_connect_count.get(cam, 0),
            "uptime_sec": 0,
            "frames_received": 0,
            "frames_inferred": 0,
            "fps_in": 0,
            "fps_out": 0,
            "latency_p50_ms": 0,
            "latency_p95_ms": 0,
            "dropped_frames": 0,
            "queue_depth": 0,
        }

    base = worker.metrics()
    base["streaming"] = True
    base["ws_reconnects"] = ws_connect_count.get(cam, 0)
    return base


@app.get("/camera_metrics/all")
def camera_metrics_all(db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    cams = db.query(Camera).all()
    out = []
    for cam in cams:
        cam_id = cam.name
        worker = workers.get(cam_id)
        if not worker:
            out.append(
                {
                    "camera_id": cam_id,
                    "streaming": False,
                    "ws_reconnects": ws_connect_count.get(cam_id, 0),
                    "uptime_sec": 0,
                    "frames_received": 0,
                    "frames_inferred": 0,
                    "fps_in": 0,
                    "fps_out": 0,
                    "latency_p50_ms": 0,
                    "latency_p95_ms": 0,
                    "dropped_frames": 0,
                    "queue_depth": 0,
                }
            )
            continue
        item = worker.metrics()
        item["streaming"] = True
        item["ws_reconnects"] = ws_connect_count.get(cam_id, 0)
        out.append(item)
    return {"metrics": out}


@app.get("/compute_mode")
def compute_mode(user: str = Depends(get_current_user)):
    return {"compute": "gpu"}


@app.get("/violations")
def get_violations(cam: str, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    rows = (
        db.query(Violation)
        .filter(Violation.camera_id == cam)
        .order_by(Violation.timestamp.desc())
        .limit(50)
        .all()
    )
    return {
        "violations": [
            {"message": row.label, "time": row.timestamp.strftime("%H:%M:%S")} for row in rows
        ]
    }


@app.get("/history")
def get_history(cam: str, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    rows = (
        db.query(Violation)
        .filter(Violation.camera_id == cam)
        .order_by(Violation.timestamp.desc())
        .limit(100)
        .all()
    )
    return {
        "history": [
            {"message": row.label, "time": row.timestamp.strftime("%H:%M:%S")} for row in rows
        ]
    }


@app.get("/analytics")
def get_analytics(cam: str, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    total = db.query(Violation).filter(Violation.camera_id == cam).count()
    violation_count = (
        db.query(Violation)
        .filter(Violation.camera_id == cam, Violation.label.like("NO-%"))
        .count()
    )
    compliant = total - violation_count
    most_common = (
        db.query(Violation.label, func.count(Violation.label))
        .filter(Violation.camera_id == cam)
        .group_by(Violation.label)
        .order_by(func.count(Violation.label).desc())
        .first()
    )
    percent = round((violation_count / total * 100), 2) if total else 0

    return {
        "camera": cam,
        "total_detections": total,
        "violations": violation_count,
        "compliant": compliant,
        "most_common_label": most_common[0] if most_common else None,
        "violation_percentage": percent,
    }


@app.get("/alarm", response_model=AlarmResponse)
def get_alarm(cam: str, user: str = Depends(get_current_user)):
    data = fall_detected_store.get(cam, default_alarm_state())
    return AlarmResponse(
        alarm=bool(data.get("detected", False)),
        timestamp=data.get("timestamp"),
        acknowledged=bool(data.get("acknowledged", False)),
        message="Fall detected!" if data.get("detected", False) else "No fall detected",
    )


@app.post("/alarm/acknowledge")
def acknowledge_alarm(cam: str, user: str = Depends(get_current_user)):
    state = fall_detected_store.setdefault(cam, default_alarm_state())
    state["detected"] = False
    state["acknowledged"] = True
    state["ack_time"] = utc_now_iso()
    return {"message": "Alarm acknowledged"}


@app.get("/notifications/sms")
def get_sms_notification_config(user: str = Depends(get_current_user)):
    db = SessionLocal()
    try:
        cfg = get_sms_config(db)
        sender = env_sms_sender()
        if not cfg:
            return {"sender_number": sender, "receiver_number": "", "enabled": False}
        return {
            "sender_number": sender,
            "receiver_number": cfg.receiver_number or "",
            "enabled": bool(cfg.enabled),
        }
    finally:
        db.close()


@app.post("/notifications/sms")
def save_sms_notification_config(payload: SmsConfigSchema, user: str = Depends(get_current_user)):
    sender = env_sms_sender()
    if not sender:
        raise HTTPException(status_code=400, detail="TWILIO_FROM_NUMBER is not configured in backend .env")
    receiver = payload.receiver_number.strip()
    validate_sms_numbers(sender, receiver)

    db = SessionLocal()
    try:
        cfg = get_sms_config(db)
        if not cfg:
            cfg = SmsConfig(
                sender_number=sender,
                receiver_number=receiver,
                enabled=payload.enabled,
            )
            db.add(cfg)
        else:
            # Sender is backend-owned; sync DB value for compatibility only.
            cfg.sender_number = sender
            cfg.receiver_number = receiver
            cfg.enabled = payload.enabled
        db.commit()
        return {"message": "SMS notification config saved"}
    finally:
        db.close()


@app.post("/notifications/sms/test")
def send_sms_test(payload: SmsTestSchema, user: str = Depends(get_current_user)):
    db = SessionLocal()
    try:
        cfg = get_sms_config(db)
        if not cfg or not cfg.enabled:
            raise HTTPException(status_code=400, detail="SMS notifications are disabled")
        sender = env_sms_sender()
        receiver = (cfg.receiver_number or "").strip()
        if not sender or not receiver:
            raise HTTPException(status_code=400, detail="Sender/receiver number is not configured")
        validate_sms_numbers(sender, receiver)
    finally:
        db.close()

    msg = (payload.message or "").strip() or f"[PPE Alert Test] Configuration test at {utc_now_iso()}."
    ok, detail, data = send_twilio_sms(sender, receiver, msg)
    db2 = SessionLocal()
    try:
        db2.add(
            SmsDeliveryLog(
                camera_id="",
                to_number=receiver,
                message=msg,
                status="success" if ok else "failed",
                detail=detail,
                provider_id=str((data or {}).get("sid", "")),
                is_test=True,
            )
        )
        db2.commit()
    finally:
        db2.close()

    if not ok:
        raise HTTPException(status_code=500, detail=detail)
    return {"message": "Test SMS sent", "provider_id": data.get("sid")}


@app.get("/notifications/sms/logs")
def get_sms_logs(limit: int = 50, user: str = Depends(get_current_user)):
    safe_limit = max(1, min(limit, 200))
    db = SessionLocal()
    try:
        rows = (
            db.query(SmsDeliveryLog)
            .order_by(SmsDeliveryLog.created_at.desc())
            .limit(safe_limit)
            .all()
        )
        return {
            "logs": [
                {
                    "id": row.id,
                    "camera_id": row.camera_id,
                    "to_number": row.to_number,
                    "message": row.message,
                    "status": row.status,
                    "detail": row.detail,
                    "provider_id": row.provider_id,
                    "is_test": bool(row.is_test),
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ]
        }
    finally:
        db.close()


@app.get("/notifications/email")
def get_email_notification_config(user: str = Depends(get_current_user)):
    db = SessionLocal()
    try:
        cfg = get_email_config(db)
        sender = env_email_sender()
        if not cfg:
            return {"sender_email": sender, "receiver_email": "", "enabled": False}
        return {
            "sender_email": sender,
            "receiver_email": cfg.receiver_email or "",
            "enabled": bool(cfg.enabled),
        }
    finally:
        db.close()


@app.post("/notifications/email")
def save_email_notification_config(payload: EmailConfigSchema, user: str = Depends(get_current_user)):
    sender = env_email_sender()
    if not sender:
        raise HTTPException(status_code=400, detail="SMTP_FROM_EMAIL or SMTP_USER is not configured in backend .env")
    receiver = payload.receiver_email.strip()
    if "@" not in sender:
        raise HTTPException(status_code=400, detail="Sender email is invalid")
    if "@" not in receiver:
        raise HTTPException(status_code=400, detail="Receiver email is invalid")

    db = SessionLocal()
    try:
        cfg = get_email_config(db)
        if not cfg:
            cfg = EmailConfig(sender_email=sender, receiver_email=receiver, enabled=payload.enabled)
            db.add(cfg)
        else:
            # Sender is backend-owned; sync DB value for compatibility only.
            cfg.sender_email = sender
            cfg.receiver_email = receiver
            cfg.enabled = payload.enabled
        db.commit()
        return {"message": "Email notification config saved"}
    finally:
        db.close()


@app.post("/notifications/email/test")
def send_email_test(payload: EmailTestSchema, user: str = Depends(get_current_user)):
    db = SessionLocal()
    try:
        cfg = get_email_config(db)
        if not cfg or not cfg.enabled:
            raise HTTPException(status_code=400, detail="Email notifications are disabled")
        sender = env_email_sender()
        receiver = (cfg.receiver_email or "").strip()
        if not sender or not receiver:
            raise HTTPException(status_code=400, detail="Sender/receiver email is not configured")
    finally:
        db.close()

    subject = (payload.subject or "").strip() or "PPE Alert Test Email"
    message = (payload.message or "").strip() or f"PPE alert email channel test at {utc_now_iso()}."
    ok, detail, _ = send_smtp_email(sender, receiver, subject, message)
    db2 = SessionLocal()
    try:
        db2.add(
            EmailDeliveryLog(
                camera_id="",
                to_email=receiver,
                subject=subject,
                message=message,
                status="success" if ok else "failed",
                detail=detail,
                is_test=True,
            )
        )
        db2.commit()
    finally:
        db2.close()
    if not ok:
        raise HTTPException(status_code=500, detail=detail)
    return {"message": "Test email sent"}


@app.get("/notifications/email/logs")
def get_email_logs(limit: int = 50, user: str = Depends(get_current_user)):
    safe_limit = max(1, min(limit, 200))
    db = SessionLocal()
    try:
        rows = (
            db.query(EmailDeliveryLog)
            .order_by(EmailDeliveryLog.created_at.desc())
            .limit(safe_limit)
            .all()
        )
        return {
            "logs": [
                {
                    "id": row.id,
                    "camera_id": row.camera_id,
                    "to_email": row.to_email,
                    "subject": row.subject,
                    "message": row.message,
                    "status": row.status,
                    "detail": row.detail,
                    "is_test": bool(row.is_test),
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ]
        }
    finally:
        db.close()


@app.get("/cameras")
def list_cameras(db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    cams = db.query(Camera).all()
    out = []
    for cam in cams:
        mode, raw_name = parse_camera_id(cam.name)
        out.append(
            {
                "id": cam.name,
                "name": raw_name,
                "mode": mode,
                "streaming": cam.name in workers,
            }
        )
    return {
        "cameras": out
    }


@app.post("/cameras")
def create_camera(
    name: str,
    mode: str = Query("upload"),
    db: Session = Depends(get_db),
    user: str = Depends(get_current_user),
):
    safe_mode = mode if mode in CAMERA_MODES else "upload"
    camera_id = make_camera_id(name, safe_mode)
    if db.query(Camera).filter(Camera.name == camera_id).first():
        raise HTTPException(status_code=400, detail="Camera exists")
    db.add(Camera(name=camera_id))
    db.commit()
    return {"message": "Camera created", "id": camera_id, "name": name.strip(), "mode": safe_mode}


@app.delete("/cameras/{name}")
def delete_camera(name: str, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    cam = db.query(Camera).filter(Camera.name == name).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    worker = workers.pop(name, None)
    if worker:
        worker.stop()

    db.query(Violation).filter(Violation.camera_id == name).delete()
    db.delete(cam)
    db.commit()

    fall_detected_store.pop(name, None)
    return {"message": "Camera deleted"}


@app.post("/stop")
def stop_camera(camId: str, user: str = Depends(get_current_user)):
    worker = workers.pop(camId, None)
    if worker:
        worker.stop()

    fall_detected_store.pop(camId, None)
    return {"message": "Camera stopped"}
