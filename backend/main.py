from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import func
from jose import jwt, JWTError
from pydantic import BaseModel
from ultralytics import YOLO
from datetime import datetime, timedelta
from models_db import SessionLocal, User, Violation, Camera
import cv2
import hashlib
import os

# ================= CONFIG =================

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
ALGORITHM = "HS256"

app = FastAPI()
security = HTTPBearer()

# ================= CORS =================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================= DATABASE DEP =================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ================= PASSWORD =================

def hash_password(password: str):
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, hashed_password: str):
    return hashlib.sha256(password.encode()).hexdigest() == hashed_password

# ================= AUTH =================

class AuthSchema(BaseModel):
    username: str
    password: str

@app.post("/signup")
def signup(data: AuthSchema, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="User already exists")

    user = User(
        username=data.username,
        hashed_password=hash_password(data.password)
    )
    db.add(user)
    db.commit()
    return {"message": "User created successfully"}

@app.post("/signin")
def signin(data: AuthSchema, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()

    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    expire = datetime.utcnow() + timedelta(hours=2)

    token = jwt.encode(
        {"sub": user.username, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM
    )

    return {"access_token": token}

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
        return username
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ================= LOAD TWO MODELS =================

model_ppe = YOLO("best.pt")   # PPE detection
model_fall = YOLO("last.pt")  # Fall detection

# ================= MEMORY STORES =================

camera_sources = {}
active_labels_store = {}
recent_logs_store = {}
camera_active = {}
fall_detected_store = {}  # Track fall detections for alarm

PPE_CLASSES = [
    "Gloves",
    "Goggles",
    "Hardhat",
    "Mask",
    "Safety Vest",
    "NO-Gloves",
    "NO-Goggles",
    "NO-Hardhat",
    "NO-Mask",
    "NO-Safety Vest"
]

# ================= ANNOTATION HELPER =================

def draw_custom_boxes(frame, results_ppe, results_fall):
    """
    Draw boxes with custom colors:
    - PPE boxes: Green (default YOLO color)
    - Fall boxes: Violet/Purple
    """
    annotated = frame.copy()
    
    # Draw PPE detections (use YOLO default annotation - green/colors)
    if results_ppe[0].boxes is not None:
        annotated = results_ppe[0].plot(img=annotated)
    
    # Draw Fall detection with violet color
    if results_fall[0].boxes is not None:
        violet_color = (180, 50, 200)  # BGR format: Blue=180, Green=50, Red=200
        
        for box in results_fall[0].boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            
            # Draw violet rectangle
            cv2.rectangle(annotated, (x1, y1), (x2, y2), violet_color, 2)
            
            # Add label
            label = results_fall[0].names[int(box.cls)]
            confidence = box.conf.item()
            text = f"{label} {confidence:.2f}"
            
            # Get text size for background
            text_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0]
            
            # Draw text background
            cv2.rectangle(
                annotated,
                (x1, y1 - text_size[1] - 5),
                (x1 + text_size[0], y1),
                violet_color,
                -1
            )
            
            # Draw text
            cv2.putText(
                annotated,
                text,
                (x1, y1 - 5),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2
            )
    
    return annotated

# ================= CAMERA MANAGEMENT =================

@app.post("/cameras")
def create_camera(name: str, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    if db.query(Camera).filter(Camera.name == name).first():
        raise HTTPException(status_code=400, detail="Camera already exists")

    cam = Camera(name=name)
    db.add(cam)
    db.commit()
    return {"message": "Camera created"}

@app.get("/cameras")
def list_cameras(db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    cams = db.query(Camera).all()
    # Return cameras with their streaming status
    return {
        "cameras": [
            {
                "name": c.name,
                "streaming": c.name in camera_sources
            } 
            for c in cams
        ]
    }

@app.delete("/cameras/{name}")
def delete_camera(name: str, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    cam = db.query(Camera).filter(Camera.name == name).first()

    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    camera_active[name] = False

    db.query(Violation).filter(
        Violation.camera_id == name
    ).delete()

    db.delete(cam)
    db.commit()

    camera_sources.pop(name, None)
    active_labels_store.pop(name, None)
    recent_logs_store.pop(name, None)
    camera_active.pop(name, None)
    fall_detected_store.pop(name, None)

    video_path = f"{name}.mp4"
    try:
        if os.path.exists(video_path):
            os.remove(video_path)
    except Exception as e:
        print("File deletion warning:", e)

    return {"message": "Camera deleted"}

# ================= VIDEO STOP =================

@app.post("/stop")
def stop_video(camId: str, user: str = Depends(get_current_user)):
    """Stop video stream and delete the video file"""
    if camId not in camera_sources:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Stop the active stream
    camera_active[camId] = False

    # Clean up memory stores
    camera_sources.pop(camId, None)
    active_labels_store.pop(camId, None)
    recent_logs_store.pop(camId, None)
    camera_active.pop(camId, None)
    fall_detected_store.pop(camId, None)

    # Delete video file
    video_path = f"{camId}.mp4"
    try:
        if os.path.exists(video_path):
            os.remove(video_path)
    except Exception as e:
        print("File deletion warning:", e)

    return {"message": "Video stopped and deleted"}

# ================= VIDEO UPLOAD =================

@app.post("/upload")
async def upload_video(
    video: UploadFile = File(...),
    camId: str = "",
    user: str = Depends(get_current_user)
):
    if not camId:
        raise HTTPException(status_code=400, detail="camId required")

    video_path = f"{camId}.mp4"

    with open(video_path, "wb") as f:
        f.write(await video.read())

    camera_sources[camId] = video_path
    active_labels_store[camId] = set()
    recent_logs_store[camId] = []
    camera_active[camId] = True

    return {"status": "uploaded"}

# ================= VIDEO STREAM =================

@app.get("/video_feed")
def video_feed(cam: str, quality: int = 70):
    if cam not in camera_sources:
        raise HTTPException(status_code=404, detail="Camera not found")

    return StreamingResponse(
        generate_frames(cam, quality),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

# ================= FRAME GENERATION =================

def generate_frames(camId, quality=70):
    if camId not in camera_sources:
        return

    cap = cv2.VideoCapture(camera_sources[camId])
    frame_count = 0
    process_interval = 2  # Process every 2nd frame for detection

    while camera_active.get(camId, False):
        success, frame = cap.read()
        if not success:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        frame = cv2.resize(frame, (640, 640))

        # Run detection on every Nth frame (skip for performance)
        if frame_count % process_interval == 0:
            # Run PPE model
            results_ppe = model_ppe(frame, conf=0.5)

            # Run Fall model
            results_fall = model_fall(frame, conf=0.5)

            # Use custom annotation with violet fall detection
            annotated = draw_custom_boxes(frame, results_ppe, results_fall)

            current_labels = set()
            has_fall = False

            # ---------------- PPE DETECTIONS ----------------
            if results_ppe[0].boxes is not None:
                for box in results_ppe[0].boxes:
                    label = model_ppe.names[int(box.cls.item())]
                    if label in PPE_CLASSES:
                        current_labels.add(label)

            # ---------------- FALL DETECTION ----------------
            if results_fall[0].boxes is not None:
                for box in results_fall[0].boxes:
                    label = model_fall.names[int(box.cls.item())]
                    if label == "Fall-Detected":
                        current_labels.add(label)
                        has_fall = True

            previous_labels = active_labels_store.get(camId, set())
            new_labels = current_labels - previous_labels

            for label in new_labels:
                timestamp = datetime.utcnow()

                db = SessionLocal()
                db.add(Violation(
                    camera_id=camId,
                    label=label,
                    timestamp=timestamp
                ))
                db.commit()
                db.close()

                if camId in recent_logs_store:
                    recent_logs_store[camId].append({
                        "message": label,
                        "time": timestamp.strftime("%H:%M:%S")
                    })

            active_labels_store[camId] = current_labels
            
            # Track fall detection for alarm system
            if has_fall:
                fall_detected_store[camId] = {
                    "detected": True,
                    "timestamp": datetime.utcnow().isoformat()
                }
            elif camId in fall_detected_store:
                fall_detected_store[camId]["detected"] = False
        else:
            # Use previous annotated frame (or original frame without annotations)
            annotated = frame

        # Encode and stream with quality control
        ret, buffer = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, quality])
        frame_bytes = buffer.tobytes()

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" +
            frame_bytes +
            b"\r\n"
        )

        frame_count += 1

    cap.release()

@app.get("/video_feed")
def video_feed(cam: str, quality: int = 70):
    if cam not in camera_sources:
        raise HTTPException(status_code=404, detail="Camera not found")

    return StreamingResponse(
        generate_frames(cam, quality),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

# ================= LIVE POLLING =================

@app.get("/violations")
def get_violations(cam: str, user: str = Depends(get_current_user)):
    if cam not in recent_logs_store:
        return {"violations": []}

    logs = recent_logs_store[cam]
    recent_logs_store[cam] = []

    return {"violations": logs}

# ================= HISTORY =================

@app.get("/history")
def get_history(cam: str, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    violations = db.query(Violation).filter(
        Violation.camera_id == cam
    ).order_by(
        Violation.timestamp.desc()
    ).limit(50).all()

    return {
        "history": [
            {
                "message": v.label,
                "time": v.timestamp.strftime("%H:%M:%S")
            }
            for v in violations
        ]
    }

# ================= ANALYTICS =================

@app.get("/analytics")
def get_analytics(cam: str, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    total = db.query(Violation).filter(
        Violation.camera_id == cam
    ).count()

    violation_count = db.query(Violation).filter(
        Violation.camera_id == cam,
        Violation.label.like("NO-%")
    ).count()

    compliant_count = total - violation_count

    most_common = db.query(
        Violation.label,
        func.count(Violation.label).label("count")
    ).filter(
        Violation.camera_id == cam
    ).group_by(
        Violation.label
    ).order_by(
        func.count(Violation.label).desc()
    ).first()

    violation_percentage = 0
    if total > 0:
        violation_percentage = round((violation_count / total) * 100, 2)

    return {
        "camera": cam,
        "total_detections": total,
        "violations": violation_count,
        "compliant": compliant_count,
        "most_common_label": most_common[0] if most_common else None,
        "violation_percentage": violation_percentage
    }

# ================= ALARM SYSTEM =================

@app.get("/alarm")
def check_alarm(cam: str, user: str = Depends(get_current_user)):
    """Check if a fall has been detected - returns alarm status"""
    if cam not in fall_detected_store:
        return {"alarm": False, "message": "No fall detection"}
    
    alarm_status = fall_detected_store[cam]
    return {
        "alarm": alarm_status.get("detected", False),
        "timestamp": alarm_status.get("timestamp"),
        "message": "Fall detected! Check immediately" if alarm_status.get("detected") else "No active fall"
    }

@app.post("/alarm/acknowledge")
def acknowledge_alarm(cam: str, user: str = Depends(get_current_user)):
    """Acknowledge the alarm to dismiss it"""
    if cam in fall_detected_store:
        fall_detected_store[cam]["detected"] = False
    return {"message": "Alarm acknowledged"}
