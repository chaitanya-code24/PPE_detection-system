from __future__ import annotations

import asyncio
import os
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

from models_db import Camera, SessionLocal, User, Violation
from schemas import AlarmResponse, InferResponse
from workers import InferenceWorker


SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
ALGORITHM = "HS256"
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
FALL_CLASS = os.getenv("FALL_CLASS", "Fall-Detected")
MAX_METADATA_STALENESS_SEC = float(os.getenv("MAX_METADATA_STALENESS_SEC", "1.0"))

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
CAMERA_MODES = {"upload", "live"}
FALL_CLEAR_REQUIRED_FRAMES = 2


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


def update_alarm_state(cam_id: str, fall_detected: bool, timestamp: str) -> None:
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
        elif not state.get("acknowledged", False):
            state["detected"] = True
    else:
        clear_frames = int(state.get("clear_frames", 0)) + 1
        state["clear_frames"] = clear_frames
        if clear_frames >= FALL_CLEAR_REQUIRED_FRAMES:
            state["active"] = False
            state["detected"] = False
            state["acknowledged"] = False


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
    _username = validate_ws_token(token)

    worker = get_worker(cam_id)

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
            update_alarm_state(
                cam_id=cam_id,
                fall_detected=bool(metadata.get("fall_detected")),
                timestamp=metadata.get("timestamp", utc_now_iso()),
            )

            await ws.send_json(metadata)
        except WebSocketDisconnect:
            break
        except Exception:
            await asyncio.sleep(0.01)


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
