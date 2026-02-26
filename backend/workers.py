from __future__ import annotations

import json
import os
import queue
import threading
import time
from typing import Any

from sqlalchemy.orm import Session

from models_db import SessionLocal, Violation
from utils import as_int, decode_jpeg, is_fall_label, utc_now_iso

try:
    import redis
except Exception:
    redis = None


class InferenceWorker:
    # Ultralytics model objects are shared across camera workers.
    # Use a global lock to avoid concurrent access corruption/empty results.
    _infer_lock = threading.Lock()

    def __init__(
        self,
        camera_id: str,
        ppe_model,
        fall_model,
        fall_class: str = "Fall-Detected",
        redis_url: str | None = None,
    ) -> None:
        self.camera_id = camera_id
        self.ppe_model = ppe_model
        self.fall_model = fall_model
        self.fall_class = fall_class
        self.ppe_conf = float(os.getenv("PPE_CONF", "0.2"))
        self.fall_conf = float(os.getenv("FALL_CONF", "0.2"))
        self.iou = float(os.getenv("YOLO_IOU", "0.45"))
        self.confirm_frames = int(os.getenv("EVENT_CONFIRM_FRAMES", "3"))
        self.event_cooldown_sec = float(os.getenv("EVENT_COOLDOWN_SEC", "3.0"))
        self._label_streak: dict[str, int] = {}
        self._last_event_at: dict[str, float] = {}

        self._queue: queue.Queue[tuple[int, bytes]] = queue.Queue(maxsize=2)
        self._results: dict[int, dict[str, Any]] = {}
        self._latest: dict[str, Any] | None = None
        self._condition = threading.Condition()
        self._running = False
        self._thread: threading.Thread | None = None
        self._seq = 0

        self._redis_client = None
        if redis and redis_url:
            try:
                self._redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
                self._redis_client.ping()
            except Exception:
                self._redis_client = None

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)

    def submit(self, frame_bytes: bytes) -> int:
        with self._condition:
            self._seq += 1
            seq = self._seq

        if self._queue.full():
            try:
                self._queue.get_nowait()
            except queue.Empty:
                pass

        self._queue.put((seq, frame_bytes))
        return seq

    def await_result(self, seq: int, timeout: float = 0.75) -> dict[str, Any] | None:
        deadline = time.time() + timeout
        with self._condition:
            while time.time() < deadline:
                if seq in self._results:
                    return self._results.pop(seq)
                remaining = deadline - time.time()
                if remaining <= 0:
                    break
                self._condition.wait(timeout=remaining)
        return None

    def latest_metadata(self) -> dict[str, Any] | None:
        return self._latest

    def _publish(self, payload: dict[str, Any]) -> None:
        if not self._redis_client:
            return
        try:
            channel = f"camera:{self.camera_id}:metadata"
            self._redis_client.publish(channel, json.dumps(payload))
        except Exception:
            pass

    def _save_rows(self, dets: list[dict[str, Any]]) -> None:
        if not dets:
            return
        db: Session = SessionLocal()
        try:
            for det in dets:
                db.add(Violation(camera_id=self.camera_id, label=det["label"], username=None))
            db.commit()
        finally:
            db.close()

    def _run_loop(self) -> None:
        while self._running:
            try:
                seq, frame_bytes = self._queue.get(timeout=0.2)
            except queue.Empty:
                continue

            frame = decode_jpeg(frame_bytes)
            if frame is None:
                continue

            try:
                payload = self._infer(frame)
            except Exception as exc:
                payload = {
                    "dets": [],
                    "fall_detected": False,
                    "timestamp": utc_now_iso(),
                    "frame_width": int(frame.shape[1]),
                    "frame_height": int(frame.shape[0]),
                    "error": f"inference_failed:{type(exc).__name__}",
                }

            self._latest = payload
            self._publish(payload)

            with self._condition:
                self._results[seq] = payload
                if len(self._results) > 8:
                    # keep memory bounded under very bursty streams
                    oldest = sorted(self._results.keys())[:-8]
                    for key in oldest:
                        self._results.pop(key, None)
                self._condition.notify_all()

    def _infer(self, frame) -> dict[str, Any]:
        dets: list[dict[str, Any]] = []
        events: list[dict[str, Any]] = []
        fall_detected = False

        frame_h, frame_w = frame.shape[:2]

        with InferenceWorker._infer_lock:
            ppe_res = self.ppe_model(frame, conf=self.ppe_conf, iou=self.iou, verbose=False)
            fall_res = self.fall_model(frame, conf=self.fall_conf, iou=self.iou, verbose=False)

        if ppe_res and ppe_res[0].boxes is not None:
            for box in ppe_res[0].boxes:
                cls_idx = int(box.cls.item())
                label = str(ppe_res[0].names[cls_idx])
                conf = float(box.conf.item())
                if conf < self._label_threshold(label, self.ppe_conf):
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                dets.append(
                    {
                        "x1": as_int(x1, maximum=frame_w - 1),
                        "y1": as_int(y1, maximum=frame_h - 1),
                        "x2": as_int(x2, maximum=frame_w - 1),
                        "y2": as_int(y2, maximum=frame_h - 1),
                        "label": label,
                        "conf": round(conf, 4),
                    }
                )
                if is_fall_label(label, self.fall_class):
                    fall_detected = True

        if fall_res and fall_res[0].boxes is not None:
            for box in fall_res[0].boxes:
                cls_idx = int(box.cls.item())
                label = str(fall_res[0].names[cls_idx])
                conf = float(box.conf.item())
                if conf < self._label_threshold(label, self.fall_conf):
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                dets.append(
                    {
                        "x1": as_int(x1, maximum=frame_w - 1),
                        "y1": as_int(y1, maximum=frame_h - 1),
                        "x2": as_int(x2, maximum=frame_w - 1),
                        "y2": as_int(y2, maximum=frame_h - 1),
                        "label": label,
                        "conf": round(conf, 4),
                    }
                )
                if is_fall_label(label, self.fall_class):
                    fall_detected = True

        # Merge overlapping duplicate boxes produced by two-model pipeline.
        if dets:
            deduped: list[dict[str, Any]] = []
            for det in sorted(dets, key=lambda d: d["conf"], reverse=True):
                if det["x2"] <= det["x1"] or det["y2"] <= det["y1"]:
                    continue
                keep = True
                for kept in deduped:
                    if det["label"] != kept["label"]:
                        continue
                    ix1 = max(det["x1"], kept["x1"])
                    iy1 = max(det["y1"], kept["y1"])
                    ix2 = min(det["x2"], kept["x2"])
                    iy2 = min(det["y2"], kept["y2"])
                    iw = max(0, ix2 - ix1)
                    ih = max(0, iy2 - iy1)
                    inter = iw * ih
                    area_a = max(1, (det["x2"] - det["x1"]) * (det["y2"] - det["y1"]))
                    area_b = max(1, (kept["x2"] - kept["x1"]) * (kept["y2"] - kept["y1"]))
                    iou = inter / float(area_a + area_b - inter + 1e-6)
                    if iou >= 0.65:
                        keep = False
                        break
                if keep:
                    deduped.append(det)
            dets = deduped
        events = self._extract_events(dets)

        return {
            "dets": dets,
            "events": events,
            "fall_detected": fall_detected,
            "timestamp": utc_now_iso(),
            "frame_width": int(frame.shape[1]),
            "frame_height": int(frame.shape[0]),
        }

    def _label_threshold(self, label: str, default_conf: float) -> float:
        norm = label.strip().lower().replace("_", "-")
        if "no-hardhat" in norm or "no-vest" in norm:
            return float(os.getenv("VIOLATION_CONF", "0.55"))
        if "fall" in norm:
            return float(os.getenv("FALL_EVENT_CONF", "0.45"))
        if "person" in norm:
            return float(os.getenv("PERSON_CONF", "0.35"))
        return float(os.getenv("COMPLIANT_CONF", str(default_conf)))

    def _extract_events(self, dets: list[dict[str, Any]]) -> list[dict[str, Any]]:
        now = time.time()
        labels_in_frame = {d["label"] for d in dets}

        # Update streak counters for all seen labels.
        known_labels = set(self._label_streak.keys()) | labels_in_frame
        for label in known_labels:
            if label in labels_in_frame:
                self._label_streak[label] = self._label_streak.get(label, 0) + 1
            else:
                self._label_streak[label] = 0

        best_det_per_label: dict[str, dict[str, Any]] = {}
        for det in dets:
            prev = best_det_per_label.get(det["label"])
            if prev is None or det["conf"] > prev["conf"]:
                best_det_per_label[det["label"]] = det

        events: list[dict[str, Any]] = []
        for label, best_det in best_det_per_label.items():
            if self._label_streak.get(label, 0) < self.confirm_frames:
                continue
            last_logged = self._last_event_at.get(label, 0.0)
            if now - last_logged < self.event_cooldown_sec:
                continue
            self._last_event_at[label] = now
            events.append(best_det)

        return events
