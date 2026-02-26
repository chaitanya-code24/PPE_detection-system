import cv2
import os
import time
import threading
from datetime import datetime, timedelta
import asyncio
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from sqlalchemy.orm import Session
from sqlalchemy import func
from jose import jwt, JWTError
from pydantic import BaseModel

from ultralytics import YOLO

from models_db import SessionLocal, User, Violation, Camera
import hashlib

# =========================================================
# CONFIG
# =========================================================

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
ALGORITHM = "HS256"

app = FastAPI()
security = HTTPBearer()


# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# YOLO MODELS (GPU if available)
# =========================================================

model_ppe = YOLO("best.pt")
model_fall = YOLO("last.pt")
USE_GPU = False
try:
    model_ppe.to("cuda")
    model_fall.to("cuda")
    USE_GPU = True
    print("GPU active ✔")
except Exception:
    try:
        model_ppe.to("cpu")
        model_fall.to("cpu")
    except Exception:
        pass
    USE_GPU = False
    print("CPU mode ❗ (GPU unavailable)")
    
# Log model class names for debugging fall detection mapping
try:
    print("PPE model classes:", model_ppe.names)
    print("Fall model classes:", model_fall.names)
except Exception as e:
    print("Error printing model names:", str(e))

# ================= LIVE CAMERA STORES =================

live_raw_frames = {}          # camId -> latest raw frame
live_raw_locks = {}           # camId -> lock for raw frame
live_grabber_active = {}      # camId -> bool

def live_frame_grabber(camId, device_index):
    cap = cv2.VideoCapture(device_index)

    # Force stable resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 30)

    while live_grabber_active.get(camId, False):
        cap.grab()
        ret, frame = cap.retrieve()

        if not ret:
            continue

        frame = cv2.resize(frame, (640, 480))

        with live_raw_locks[camId]:
            live_raw_frames[camId] = frame

        time.sleep(0.001)

    cap.release()

def live_detection_worker(camId):
    frame_count = 0

    # Enable FP16 if GPU
    if USE_GPU:
        model_ppe.model.half()
        model_fall.model.half()

    while live_grabber_active.get(camId, False):

        with live_raw_locks[camId]:
            frame = live_raw_frames.get(camId)

        if frame is None:
            time.sleep(0.005)
            continue

        if frame_count % BALANCED_INTERVAL == 0:

            # GPU inference
            ppe_res = model_ppe(frame, conf=0.5, verbose=False)
            fall_res = model_fall(frame, conf=0.5, verbose=False)

            annotated = draw_boxes(frame, ppe_res, fall_res)

            detected_labels = set()
            fall_found = False

            # PPE labels
            if ppe_res[0].boxes is not None:
                for box in ppe_res[0].boxes:
                    detected_labels.add(model_ppe.names[int(box.cls)])

            # FALL labels
            if fall_res[0].boxes is not None:
                for box in fall_res[0].boxes:
                    cls = model_fall.names[int(box.cls)]
                    detected_labels.add(cls)
                    if cls == FALL_CLASS:
                        fall_found = True

            now = datetime.utcnow()

            # Save logs
            for lbl in detected_labels:
                if lbl != FALL_CLASS:
                    recent_logs_store[camId].append({
                        "message": lbl,
                        "time": now.strftime("%H:%M:%S")
                    })

            # Fall confirmation logic
            if fall_found:
                entry = fall_detected_store.get(camId, {})
                last_alerted = entry.get("last_alerted")

                if not last_alerted or (now - last_alerted).total_seconds() > FALL_ALERT_COOLDOWN:
                    fall_detected_store[camId] = {
                        "detected": True,
                        "timestamp": now.isoformat(),
                        "last_alerted": now,
                        "acknowledged": False
                    }

            # Update stream frame
            with frame_locks[camId]:
                latest_frames[camId] = annotated

        frame_count += 1
        time.sleep(0.002)

# =========================================================
# MEMORY STORES
# =========================================================

camera_sources = {}
camera_active = {}
latest_frames = {}
frame_locks = {}

recent_logs_store = {}
fall_detected_store = {}

# NEW: last saved timestamp per label
last_saved_store = {}   # camId -> { label -> timestamp }

# Fall alert debouncing and confirmation
fall_counter_store = {}     # camId -> consecutive fall detections
FALL_CONFIRMATION_COUNT = 2  # require N consecutive detections to confirm a fall
FALL_ALERT_COOLDOWN = 30     # seconds to wait before re-alerting for same camera


BALANCED_INTERVAL = 3
SAVE_INTERVAL_SECONDS = 10  # save each label at most every 10 seconds

FALL_CLASS = "Fall-Detected"


# =========================================================
# HELPERS
# =========================================================

def hash_password(password: str):
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, hashed: str):
    return hashlib.sha256(password.encode()).hexdigest() == hashed

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

from fastapi import WebSocket, WebSocketDisconnect

@app.websocket("/ws/video")
async def video_ws(ws: WebSocket):
    await ws.accept()

    camId = ws.query_params.get("cam")
    token = ws.query_params.get("token")

    # Validate camera
    if camId not in camera_active:
        await ws.close()
        return

    try:
        while camera_active.get(camId, False):
            # Get latest frame
            with frame_locks[camId]:
                frame = latest_frames.get(camId)

            if frame is None:
                await asyncio.sleep(0.01)
                continue

            # Encode as JPEG
            ret, buffer = cv2.imencode(".jpg", frame)
            if not ret:
                continue

            await ws.send_bytes(buffer.tobytes())
            await asyncio.sleep(0.03)  # ~30 FPS

    except WebSocketDisconnect:
        print(f"WebSocket disconnected: {camId}")
    except Exception as e:
        print("WS error:", e)

# =========================================================
# AUTH
# =========================================================

class AuthSchema(BaseModel):
    username: str
    password: str

@app.post("/signup")
def signup(data: AuthSchema, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(400, "User already exists")
    user = User(username=data.username, hashed_password=hash_password(data.password))
    db.add(user)
    db.commit()
    return {"message": "User created"}

@app.post("/signin")
def signin(data: AuthSchema, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(400, "Invalid credentials")

    expire = datetime.utcnow() + timedelta(hours=2)
    token = jwt.encode({"sub": user.username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)
    return {"access_token": token}

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(401, "Invalid token")
        return username
    except Exception:
        raise HTTPException(401, "Invalid token")


# =========================================================
# DRAWING BOXES
# =========================================================

def draw_boxes(frame, ppe_res, fall_res):
    annotated = ppe_res[0].plot(img=frame.copy())  # PPE with YOLO default colors

    violet = (180, 50, 200)
    if fall_res[0].boxes is not None:
        for box in fall_res[0].boxes:
            cls_name = fall_res[0].names[int(box.cls)]
            if cls_name == FALL_CLASS:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                cv2.rectangle(annotated, (x1, y1), (x2, y2), violet, 2)
                cv2.putText(
                    annotated,
                    f"{cls_name} {box.conf.item():.2f}",
                    (x1, y1 - 5),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (255,255,255),
                    2
                )
    return annotated


# =========================================================
# DETECTION WORKER (thread per camera)
# =========================================================

def detection_worker(camId):
    cap = cv2.VideoCapture(camera_sources[camId])
    frame_count = 0
    last_annotated = None
    prev_frame_idx = -1

    last_saved_store[camId] = {}  # init dictionary

    while camera_active.get(camId, False):

        ok, frame = cap.read()
        if not ok:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue
        # detect if video looped (frame index decreased or reset)
        try:
            curr_idx = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
            if prev_frame_idx != -1 and curr_idx <= prev_frame_idx:
                # video looped — reset fall counters and allow new alerts
                try:
                    fall_counter_store[camId] = 0
                except Exception:
                    pass
                try:
                    if camId in fall_detected_store:
                        fall_detected_store[camId]["last_alerted"] = None
                        fall_detected_store[camId]["acknowledged"] = False
                except Exception:
                    pass
                try:
                    last_saved_store[camId] = {}
                except Exception:
                    pass
            prev_frame_idx = curr_idx
        except Exception:
            # ignore frame index errors (can't detect loop)
            pass

        frame = cv2.resize(frame, (640, 480))

        # Run inference every 3 frames
        if frame_count % BALANCED_INTERVAL == 0:

            ppe_res = model_ppe(frame, conf=0.5)
            fall_res = model_fall(frame, conf=0.5)

            annotated = draw_boxes(frame, ppe_res, fall_res)
            last_annotated = annotated

            detected_labels = set()
            fall_found = False

            # PPE
            if ppe_res[0].boxes is not None:
                for box in ppe_res[0].boxes:
                    detected_labels.add(model_ppe.names[int(box.cls)])

            # FALL
            if fall_res[0].boxes is not None:
                for box in fall_res[0].boxes:
                    cls = model_fall.names[int(box.cls)]
                    detected_labels.add(cls)
                    if cls == FALL_CLASS:
                        fall_found = True

            # Also treat a fall if any model (PPE or Fall) produced the FALL_CLASS label
            try:
                if any(lbl == FALL_CLASS for lbl in detected_labels):
                    fall_found = True
            except Exception:
                pass
            
            # Debug: log detected labels occasionally (once every 10 inferences)
            try:
                if frame_count % (BALANCED_INTERVAL * 10) == 0:
                    print(f"[DEBUG] cam={camId} labels={detected_labels} fall_found={fall_found}")
                if fall_found:
                    print(f"[ALERT] Fall detected on {camId} labels={detected_labels}")
            except Exception as e:
                print("Error logging detection debug:", str(e))

            # ===== SAVE detections (compliant + violations) =====
            now = datetime.utcnow()

            try:
                db = SessionLocal()
                for lbl in detected_labels:

                    last_ts = last_saved_store[camId].get(lbl)

                    # If never saved or saved long ago → save again
                    if not last_ts or (now - last_ts).total_seconds() >= SAVE_INTERVAL_SECONDS:

                        db.add(Violation(
                            camera_id=camId,
                            label=lbl,
                            timestamp=now,
                            username=None
                        ))

                        last_saved_store[camId][lbl] = now

                        # Add to recent logs (frontend) — skip fall alerts so UI handles them separately
                        if lbl != FALL_CLASS:
                            recent_logs_store[camId].append({
                                "message": lbl,
                                "time": now.strftime("%H:%M:%S")
                            })

                db.commit()
                db.close()

            except Exception as e:
                print("DB write error:", str(e))

            # FALL alarm: require confirmation and apply cooldown to avoid repeated alerts
            if fall_found:
                fall_counter_store[camId] = fall_counter_store.get(camId, 0) + 1
            else:
                fall_counter_store[camId] = 0

            confirmed_fall = fall_counter_store.get(camId, 0) >= FALL_CONFIRMATION_COUNT

            if confirmed_fall:
                now = datetime.utcnow()
                entry = fall_detected_store.get(camId, {})
                last_alerted = entry.get("last_alerted")
                acknowledged = entry.get("acknowledged", False)

                # only set detected True when not acknowledged and cooldown passed
                if (not acknowledged) and ((not last_alerted) or (now - last_alerted).total_seconds() >= FALL_ALERT_COOLDOWN):
                    fall_detected_store[camId] = {
                        "detected": True,
                        "timestamp": now.isoformat(),
                        "last_alerted": now,
                        "acknowledged": False,
                    }

            # Store frame
            with frame_locks[camId]:
                latest_frames[camId] = last_annotated

        frame_count += 1
        time.sleep(0.01)

    cap.release()


# =========================================================
# STREAM
# =========================================================

def generate_frames(camId):
    while camera_active.get(camId, False):

        with frame_locks[camId]:
            frame = latest_frames.get(camId)

        if frame is None:
            time.sleep(0.01)
            continue

        ret, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 40])
        yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n"

        time.sleep(0.03)


# =========================================================
# API ENDPOINTS (unchanged for frontend)
# =========================================================

@app.post("/upload")
async def upload_video(video: UploadFile = File(...), camId: str = "", user: str = Depends(get_current_user)):

    if camId == "":
        raise HTTPException(400, "camId required")

    filepath = f"{camId}.mp4"
    with open(filepath, "wb") as f:
        f.write(await video.read())

    camera_sources[camId] = filepath
    camera_active[camId] = True

    latest_frames[camId] = None
    recent_logs_store[camId] = []
    fall_detected_store[camId] = {"detected": False, "last_alerted": None, "acknowledged": False}
    frame_locks[camId] = threading.Lock()

    threading.Thread(target=detection_worker, args=(camId,), daemon=True).start()

    return {"status": "uploaded"}


@app.post("/start_local")
def start_local_camera(name: str, device: int = 0, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    """Start a system/local camera device (e.g. device=0) as a named camera.

    - `name`: camera name to register and use
    - `device`: OS camera device index (0,1,...)
    """
    # ensure camera exists in DB
    cam = db.query(Camera).filter(Camera.name == name).first()
    if not cam:
        cam = Camera(name=name)
        db.add(cam)
        db.commit()

    # if already active, return error
    if camera_active.get(name):
        raise HTTPException(status_code=400, detail="Camera already active")

    # set up the device as the source (OpenCV accepts integer device index)
    camera_sources[name] = int(device)
    camera_active[name] = True
    latest_frames[name] = None
    recent_logs_store[name] = []
    fall_detected_store[name] = {"detected": False, "last_alerted": None, "acknowledged": False}
    frame_locks[name] = threading.Lock()
    last_saved_store[name] = {}

    threading.Thread(target=detection_worker, args=(name,), daemon=True).start()

    return {"message": f"Local camera '{name}' started on device {device}"}


@app.get("/discover_devices")
def discover_devices(max_index: int = 5, user: str = Depends(get_current_user)):
    """Probe system camera device indexes 0..max_index and return available ones."""
    available = []
    for i in range(0, max_index + 1):
        try:
            cap = cv2.VideoCapture(i)
            ok, _ = cap.read()
            cap.release()
            if ok:
                available.append({"device": i, "label": f"Device {i}"})
        except Exception:
            try:
                cap.release()
            except:
                pass
    return {"devices": available}


@app.get("/compute_mode")
def compute_mode(user: str = Depends(get_current_user)):
    """Return whether models are running on GPU or CPU."""
    return {"compute": "gpu" if USE_GPU else "cpu"}


@app.get("/camera_status")
def camera_status(cam: str, user: str = Depends(get_current_user)):
    """Return status for a named camera: active, streaming source, and last alert info."""
    if cam not in camera_sources and cam not in [c.name for c in SessionLocal().query(Camera).all()]:
        raise HTTPException(status_code=404, detail="Camera not found")

    active = camera_active.get(cam, False)
    source = camera_sources.get(cam)
    last = fall_detected_store.get(cam, {})
    return {
        "camera": cam,
        "active": bool(active),
        "source": source,
        "last_alert": last.get("timestamp"),
        "acknowledged": bool(last.get("acknowledged", False)),
    }


@app.get("/video_feed")
def video_feed(cam: str):
    if cam not in camera_sources:
        raise HTTPException(404, "Camera not found")
    return StreamingResponse(
        generate_frames(cam),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


@app.post("/stop")
def stop_video(camId: str):
    if camId not in camera_sources:
        raise HTTPException(404, "Camera not found")

    camera_active[camId] = False
    time.sleep(0.1)

    camera_sources.pop(camId, None)
    latest_frames.pop(camId, None)
    recent_logs_store.pop(camId, None)
    fall_detected_store.pop(camId, None)

    try:
        os.remove(f"{camId}.mp4")
    except:
        pass

    return {"message": "Video stopped and deleted"}


@app.get("/violations")
def get_violations(cam: str):
    logs = recent_logs_store.get(cam, [])
    recent_logs_store[cam] = []
    return {"violations": logs}


@app.get("/history")
def get_history(cam: str, db: Session = Depends(get_db)):
    rows = db.query(Violation).filter(Violation.camera_id == cam).order_by(
        Violation.timestamp.desc()).limit(50).all()
    return {
        "history": [
            {"message": r.label, "time": r.timestamp.strftime("%H:%M:%S")}
            for r in rows
        ]
    }


@app.get("/analytics")
def get_analytics(cam: str, db: Session = Depends(get_db)):

    total = db.query(Violation).filter(Violation.camera_id == cam).count()
    violation_count = db.query(Violation).filter(
        Violation.camera_id == cam,
        Violation.label.like("NO-%")
    ).count()

    compliant = total - violation_count

    most_common = (
        db.query(Violation.label, func.count(Violation.label))
        .filter(Violation.camera_id == cam)
        .group_by(Violation.label)
        .order_by(func.count(Violation.label).desc())
        .first()
    )

    percent = round((violation_count / total * 100), 2) if total > 0 else 0

    return {
        "camera": cam,
        "total_detections": total,
        "violations": violation_count,
        "compliant": compliant,
        "most_common_label": most_common[0] if most_common else None,
        "violation_percentage": percent
    }


@app.get("/alarm")
def get_alarm(cam: str):
    data = fall_detected_store.get(cam, {"detected": False, "acknowledged": False})
    return {
        "alarm": bool(data.get("detected", False)),
        "timestamp": data.get("timestamp"),
        "acknowledged": bool(data.get("acknowledged", False)),
        "message": "Fall detected!" if data.get("detected") else "No fall detected"
    }


@app.post("/alarm/acknowledge")
def ack_alarm(cam: str):
    if cam in fall_detected_store:
        # mark acknowledged and clear detected flag so UI won't re-alert
        fall_detected_store[cam]["acknowledged"] = True
        fall_detected_store[cam]["detected"] = False
        # record ack time
        fall_detected_store[cam]["ack_time"] = datetime.utcnow().isoformat()
    return {"message": "Alarm acknowledged"}


@app.get("/cameras")
def list_cameras(db: Session = Depends(get_db)):
    cams = db.query(Camera).all()
    return {
        "cameras": [
            {"name": c.name, "streaming": c.name in camera_sources}
            for c in cams
        ]
    }


@app.post("/cameras")
def create_camera(name: str, db: Session = Depends(get_db)):
    if db.query(Camera).filter(Camera.name == name).first():
        raise HTTPException(400, "Camera exists")
    db.add(Camera(name=name))
    db.commit()
    return {"message": "Camera created"}


@app.delete("/cameras/{name}")
def delete_camera(name: str, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.name == name).first()
    if not cam:
        raise HTTPException(404, "Camera not found")

    camera_active[name] = False
    time.sleep(0.1)

    db.query(Violation).filter(Violation.camera_id == name).delete()
    db.delete(cam)
    db.commit()

    for store in [camera_sources, latest_frames, recent_logs_store, fall_detected_store]:
        store.pop(name, None)

    try:
        os.remove(f"{name}.mp4")
    except:
        pass

    return {"message": "Camera deleted"}


@app.post("/stop")
def stop_video(camId: str):
    # Stop uploaded-video or live camera
    camera_active[camId] = False
    live_grabber_active[camId] = False   # 🔥 NEW — stops live camera thread

    time.sleep(0.1)

    # Cleanup memory stores
    camera_sources.pop(camId, None)
    live_raw_frames.pop(camId, None)
    live_raw_locks.pop(camId, None)

    latest_frames.pop(camId, None)
    frame_locks.pop(camId, None)
    recent_logs_store.pop(camId, None)
    fall_detected_store.pop(camId, None)

    # Remove saved uploaded video file (if exists)
    try:
        os.remove(f"{camId}.mp4")
    except:
        pass

    return {"message": "Camera stopped and deleted"}