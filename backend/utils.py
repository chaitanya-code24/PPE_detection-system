from __future__ import annotations

from datetime import datetime, timezone

import cv2
import numpy as np


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def decode_jpeg(frame_bytes: bytes):
    arr = np.frombuffer(frame_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def as_int(value: float, minimum: int = 0, maximum: int | None = None) -> int:
    iv = int(value)
    if iv < minimum:
        return minimum
    if maximum is not None and iv > maximum:
        return maximum
    return iv


def normalize_label(label: str) -> str:
    return label.strip().lower().replace("_", "-")


def is_fall_label(label: str, fall_class: str) -> bool:
    norm = normalize_label(label)
    expected = normalize_label(fall_class)
    return norm == expected or "fall" in norm
