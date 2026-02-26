from pydantic import BaseModel


class Detection(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int
    label: str
    conf: float


class InferPayload(BaseModel):
    dets: list[Detection]
    events: list[Detection] = []
    fall_detected: bool
    timestamp: str
    frame_width: int | None = None
    frame_height: int | None = None


class InferResponse(InferPayload):
    pass


class AlarmResponse(BaseModel):
    alarm: bool
    timestamp: str | None
    acknowledged: bool
    message: str
