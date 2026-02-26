import { getToken } from "@/lib/api";

export type Detection = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  conf: number;
};

export type InferMetadata = {
  dets: Detection[];
  events?: Detection[];
  fall_detected: boolean;
  timestamp: string;
  frame_width?: number | null;
  frame_height?: number | null;
};

const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE ?? "ws://127.0.0.1:8000";

export function createInferSocket(
  camId: string,
  onMetadata: (meta: InferMetadata) => void,
  onClose?: () => void,
): WebSocket {
  const token = getToken();
  const qs = new URLSearchParams({ cam: camId, token: token ?? "" });
  const ws = new WebSocket(`${WS_BASE}/ws/infer?${qs.toString()}`);

  ws.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as InferMetadata;
      onMetadata(parsed);
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    onClose?.();
  };

  return ws;
}

export async function sendCanvasFrame(
  sourceVideo: HTMLVideoElement,
  workCanvas: HTMLCanvasElement,
  ws: WebSocket,
): Promise<void> {
  if (ws.readyState !== WebSocket.OPEN || sourceVideo.videoWidth === 0 || sourceVideo.videoHeight === 0) {
    return;
  }

  workCanvas.width = sourceVideo.videoWidth;
  workCanvas.height = sourceVideo.videoHeight;

  const ctx = workCanvas.getContext("2d");
  if (!ctx) return;

  ctx.drawImage(sourceVideo, 0, 0, workCanvas.width, workCanvas.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    workCanvas.toBlob((b) => resolve(b), "image/jpeg", 0.72);
  });

  if (!blob) return;
  const buffer = await blob.arrayBuffer();
  ws.send(buffer);
}
