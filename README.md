# Realtime PPE Fall Detection

Real-time PPE compliance and fall-detection platform built with a `FastAPI` backend and a `Next.js` frontend. Video stays in the browser for playback, while the backend only receives sampled JPEG frames over WebSocket, runs YOLO inference on GPU, and returns metadata for overlays, alerts, history, and analytics.

## What It Does

- Supports both uploaded videos and live camera feeds
- Runs PPE + fall detection using YOLO models on the backend GPU
- Sends frames to backend through a single WebSocket endpoint: `/ws/infer`
- Draws bounding boxes in the frontend from returned metadata only
- Stores detections for history and analytics
- Tracks camera health and stream metrics
- Supports alert acknowledgement flow for fall incidents
- Supports SMS and email notifications with delivery logs

## Architecture

### Frontend

- Framework: `Next.js 16` with App Router
- Live stream: `getUserMedia()`
- Upload stream: HTML5 `<video>` with local file playback
- Frame capture: canvas snapshot every `200ms`
- Overlay rendering: frontend canvas using backend metadata

### Backend

- Framework: `FastAPI`
- Inference: `ultralytics` YOLO models on CUDA
- Worker model: one inference worker per camera stream
- Transport: WebSocket metadata pipeline, no MJPEG/JPEG streaming endpoint
- Storage: SQLite via SQLAlchemy
- Optional fan-out support: Redis pub/sub inside worker pipeline

## Current Project Structure

```text
backend/
  main.py              FastAPI app and API routes
  workers.py           Inference worker and thresholds
  notifications.py     Twilio + SMTP senders
  models_db.py         SQLAlchemy models
  schemas.py           Response schemas
  utils.py             JPEG decode and helpers
  requirements.txt

frontend/
  app/                 Next.js routes
  components/          Video tiles, overlays, alerts, dashboard UI
  lib/                 API and websocket helpers
  package.json
```

## Main Features

- Multi-camera dashboard with upload and live sources
- Persistent stream sessions across page navigation
- Detection logs and incident history
- Analytics per camera
- Camera health page for throughput, latency, and dropped frames
- Notification settings page with:
  - SMS receiver configuration
  - Email receiver configuration
  - Unified delivery logs

## Hardcoded Runtime Settings

Some core inference and runtime values are intentionally hardcoded in code, not read from `backend/.env`.

Defined in [main.py](C:/Users/chait/Downloads/PPE/backend/main.py) and [workers.py](C:/Users/chait/Downloads/PPE/backend/workers.py):

- `SECRET_KEY = "change-me"`
- `REDIS_URL = "redis://127.0.0.1:6379/0"`
- `REQUIRE_WS_AUTH = True`
- `PPE_MODEL_PATH = "best.pt"`
- `FALL_MODEL_PATH = "last.pt"`
- `FALL_CLASS = "Fall-Detected"`
- `MAX_METADATA_STALENESS_SEC = 1.0`
- `PPE_CONF = 0.2`
- `FALL_CONF = 0.2`
- `YOLO_IOU = 0.45`
- `VIOLATION_CONF = 0.55`
- `FALL_EVENT_CONF = 0.45`
- `PERSON_CONF = 0.35`
- `COMPLIANT_CONF = 0.2`
- `EVENT_CONFIRM_FRAMES = 3`
- `EVENT_COOLDOWN_SEC = 3.0`

## Prerequisites

- Python `3.10+`
- Node.js `18+`
- NVIDIA GPU with CUDA available to PyTorch
- Redis running locally at `redis://127.0.0.1:6379/0` if pub/sub path is needed

Important: backend startup will fail if CUDA is not available.

## Backend Setup

From the project root:

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

## Frontend Setup

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:3000` by default. Backend API base is currently fixed to `http://127.0.0.1:8000` in [api.ts](C:/Users/chait/Downloads/PPE/frontend/lib/api.ts).

## Environment Variables Still Used

The backend still reads notification provider settings from `backend/.env`.

### Twilio

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+15551234567
```

### SMTP

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@yourdomain.com
SMTP_PASS=your_app_password
SMTP_USE_TLS=true
SMTP_FROM_EMAIL=alerts@yourdomain.com
```

Sender values are backend-owned. The frontend only configures receiver addresses/numbers and enabled state.

## Authentication

- `POST /signup`
- `POST /signin`

JWT token is stored in browser cookies by the frontend. WebSocket inference access also requires a valid token.

## Core API Endpoints

### Streaming and inference

- `POST /upload`
- `POST /start_video`
- `POST /stop`
- `WS /ws/infer`

### Monitoring

- `GET /camera_metrics`
- `GET /camera_metrics/all`
- `GET /compute_mode`
- `GET /cameras`
- `POST /cameras`

### Detections

- `GET /violations`
- `GET /history`
- `GET /analytics`

### Alarm

- `GET /alarm`
- `POST /alarm/acknowledge`

### Notifications

- `GET /notifications/sms`
- `POST /notifications/sms`
- `POST /notifications/sms/test`
- `GET /notifications/sms/logs`
- `GET /notifications/email`
- `POST /notifications/email`
- `POST /notifications/email/test`
- `GET /notifications/email/logs`

## WebSocket Metadata Format

Example payload returned from `/ws/infer`:

```json
{
  "dets": [
    {
      "x1": 123,
      "y1": 45,
      "x2": 210,
      "y2": 300,
      "label": "Hardhat",
      "conf": 0.92
    }
  ],
  "events": [],
  "fall_detected": false,
  "timestamp": "2026-02-27T18:21:00Z",
  "frame_width": 1280,
  "frame_height": 720
}
```

## Frontend Pages

- `/signin`
- `/signup`
- `/dashboard`
- `/history`
- `/analytics`
- `/health`
- `/notifications`
- `/cameras`

## Notes and Constraints

- Backend does not stream video frames back to the client
- Bounding boxes are always drawn in the frontend
- Detection history is stored in `backend/users.db`
- Model files currently expected in `backend/best.pt` and `backend/last.pt`
- Uploaded videos are processed using the same WebSocket inference path as live camera

## Recommended Production Improvements

- Move hardcoded secrets like `SECRET_KEY` back to a secure secret manager
- Replace SQLite with PostgreSQL for multi-user production usage
- Add structured logging instead of `print()`
- Add database migrations
- Add background job retry policy for notifications
- Add model/version reporting endpoint

## Verification

Basic checks already used during development:

```powershell
python -m py_compile backend/main.py backend/workers.py backend/notifications.py backend/models_db.py backend/schemas.py
cd frontend
cmd /c npx tsc --noEmit --incremental false
```
