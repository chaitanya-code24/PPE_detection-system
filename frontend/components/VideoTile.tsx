"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, clearToken, getToken, isTokenExpired } from "@/lib/api";
import FallAlert from "@/components/FallAlert";
import MetadataRenderer from "@/components/MetadataRenderer";
import { InferMetadata, createInferSocket, sendCanvasFrame } from "@/lib/wsClient";
import { clearUploadSession, getUploadSession, setUploadAutoStart, setUploadSession } from "@/lib/streamSession";

const SEND_INTERVAL_MS = 200;

type VideoTileProps = {
  camId: string;
  title?: string;
  addLog?: (camera: string, message: string, time?: string) => void;
  onStreamStart?: (camera: string) => void;
  onStreamStop?: (camera: string) => void;
};

function VideoTile({ camId, title, addLog, onStreamStart, onStreamStop }: VideoTileProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rafRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const lastSentAtRef = useRef(0);
  const awaitingResultRef = useRef(false);
  const lastLabelAtRef = useRef<Map<string, number>>(new Map());
  const shouldRunRef = useRef(false);
  const runningRef = useRef(false);
  const acknowledgedFallRef = useRef(false);
  const fallTrueCountRef = useRef(0);
  const fallFalseCountRef = useRef(0);
  const lastPopupAtRef = useRef(0);

  const [videoUrl, setVideoUrl] = useState<string | null>(() => getUploadSession(camId)?.videoUrl ?? null);
  const [metadata, setMetadata] = useState<InferMetadata | null>(null);
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const showAlertRef = useRef(false);
  const [connection, setConnection] = useState<"idle" | "connecting" | "open" | "closed">("idle");

  useEffect(() => {
    showAlertRef.current = showAlert;
  }, [showAlert]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const handleAuthError = useCallback(() => {
    clearToken();
    router.push("/signin");
  }, [router]);

  const stopSocketsAndLoops = useCallback(() => {
    shouldRunRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    awaitingResultRef.current = false;
  }, []);

  const connectSocket = useCallback(() => {
    const token = getToken();
    if (!token || isTokenExpired(token)) {
      handleAuthError();
      return;
    }

    const ws = createInferSocket(
      camId,
      (incoming) => {
        awaitingResultRef.current = false;
        setMetadata(incoming);

        if (incoming.fall_detected) {
          fallTrueCountRef.current += 1;
          fallFalseCountRef.current = 0;
        } else {
          fallFalseCountRef.current += 1;
          if (fallFalseCountRef.current >= 3) {
            fallTrueCountRef.current = 0;
            acknowledgedFallRef.current = false;
          }
        }

        const cooldownPassed = Date.now() - lastPopupAtRef.current > 8000;
        if (
          fallTrueCountRef.current >= 2 &&
          !showAlertRef.current &&
          !acknowledgedFallRef.current &&
          cooldownPassed
        ) {
          setShowAlert(true);
          lastPopupAtRef.current = Date.now();
        }

        const now = Date.now();
        const logSource = incoming.events && incoming.events.length > 0 ? incoming.events : incoming.dets;
        for (const det of logSource) {
          const key = `${camId}:${det.label}`;
          const lastAt = lastLabelAtRef.current.get(key) ?? 0;
          if (now - lastAt > 1500) {
            addLog?.(camId, `${det.label} ${(det.conf * 100).toFixed(1)}%`);
            lastLabelAtRef.current.set(key, now);
          }
        }
      },
      () => {
        awaitingResultRef.current = false;
        setConnection("closed");
        if (shouldRunRef.current) {
          reconnectTimerRef.current = window.setTimeout(connectSocket, 600);
        }
      },
    );
    setConnection("connecting");
    ws.onopen = () => {
      setConnection("open");
      addLog?.(camId, "Inference websocket connected");
    };

    wsRef.current = ws;
  }, [addLog, camId, handleAuthError]);

  const frameLoop = useCallback(async () => {
    if (!shouldRunRef.current) return;

    const ws = wsRef.current;
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;

    if (ws && video && canvas) {
      const now = performance.now();
      if (
        now - lastSentAtRef.current >= SEND_INTERVAL_MS &&
        video.readyState >= 2 &&
        ws.readyState === WebSocket.OPEN &&
        !awaitingResultRef.current &&
        ws.bufferedAmount < 256_000
      ) {
        lastSentAtRef.current = now;
        awaitingResultRef.current = true;
        try {
          await sendCanvasFrame(video, canvas, ws);
        } catch {
          awaitingResultRef.current = false;
        }
      }
    }

    rafRef.current = requestAnimationFrame(() => {
      void frameLoop();
    });
  }, []);

  const start = useCallback(() => {
    if (!videoRef.current || runningRef.current) return;
    shouldRunRef.current = true;
    setRunning(true);
    setUploadAutoStart(camId, true);
    connectSocket();
    onStreamStart?.(camId);
    void frameLoop();
  }, [camId, connectSocket, frameLoop, onStreamStart]);

  const stop = useCallback(async () => {
    stopSocketsAndLoops();
    setRunning(false);
    setConnection("idle");
    setShowAlert(false);
    setUploadAutoStart(camId, false);
    onStreamStop?.(camId);

    const token = getToken();
    if (token && !isTokenExpired(token)) {
      await fetch(`${API_BASE}/stop?camId=${encodeURIComponent(camId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    clearUploadSession(camId);
    setVideoUrl(null);
    setMetadata(null);
  }, [camId, onStreamStop, stopSocketsAndLoops]);

  const onUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const token = getToken();
      if (!token || isTokenExpired(token)) {
        handleAuthError();
        return;
      }

      setUploading(true);

      const formData = new FormData();
      formData.append("video", file);

      try {
        await fetch(`${API_BASE}/upload?camId=${encodeURIComponent(camId)}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (videoUrl) {
          clearUploadSession(camId);
        }
        const objectUrl = URL.createObjectURL(file);
        setVideoUrl(objectUrl);
        setUploadSession(camId, { videoUrl: objectUrl, autoStart: true });
        setMetadata(null);
        addLog?.(camId, "Local video ready for inference");
        window.setTimeout(() => {
          if (!shouldRunRef.current) {
            shouldRunRef.current = true;
            setRunning(true);
            connectSocket();
            onStreamStart?.(camId);
            void frameLoop();
          }
        }, 100);
      } finally {
        setUploading(false);
      }
    },
    [addLog, camId, connectSocket, frameLoop, handleAuthError, onStreamStart, videoUrl],
  );

  const acknowledgeFall = useCallback(async () => {
    const token = getToken();
    if (token && !isTokenExpired(token)) {
      await fetch(`${API_BASE}/alarm/acknowledge?cam=${encodeURIComponent(camId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    acknowledgedFallRef.current = true;
    lastPopupAtRef.current = Date.now();
    setShowAlert(false);
  }, [camId]);

  useEffect(() => {
    return () => {
      stopSocketsAndLoops();
    };
  }, [stopSocketsAndLoops]);

  useEffect(() => {
    if (!videoUrl || running) return;
    const session = getUploadSession(camId);
    if (session?.autoStart) {
      const t = window.setTimeout(() => start(), 100);
      return () => window.clearTimeout(t);
    }
  }, [camId, running, start, videoUrl]);

  useEffect(() => {
    const session = getUploadSession(camId);
    if (!videoUrl || !session?.autoStart) return;

    const ensure = () => {
      if (!shouldRunRef.current && !runningRef.current) {
        start();
      }
    };

    const id = window.setInterval(ensure, 1500);
    ensure();
    return () => window.clearInterval(id);
  }, [camId, start, videoUrl]);

  const status = useMemo(() => {
    if (!videoUrl) return "Upload a file";
    if (running) return "Inferencing";
    return "Ready";
  }, [running, videoUrl]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{camId} - Upload Source</h3>
          <p className="text-xs text-gray-500">{title ?? status}</p>
        </div>
        {running ? (
          <button onClick={() => void stop()} className="rounded bg-gray-900 px-3 py-1.5 text-xs text-white hover:bg-black">
            Stop
          </button>
        ) : (
          <button
            onClick={() => start()}
            disabled={!videoUrl}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            Start
          </button>
        )}
      </div>

      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              className="h-full w-full object-contain"
              controls
              autoPlay
              loop
              muted
              playsInline
              onLoadedData={() => {
                void videoRef.current?.play().catch(() => undefined);
              }}
            />
            <MetadataRenderer videoRef={videoRef} metadata={metadata} />
            <FallAlert visible={showAlert} onAcknowledge={() => void acknowledgeFall()} camera={camId} />
          </>
        ) : (
          <label className="flex h-full cursor-pointer items-center justify-center text-center text-sm text-gray-300">
            <span>{uploading ? "Uploading..." : "Choose video file"}</span>
            <input type="file" hidden accept="video/*" onChange={onUpload} />
          </label>
        )}
      </div>

      {videoUrl && (
        <label className="mt-3 mr-2 inline-block cursor-pointer rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50">
          Replace file
          <input type="file" hidden accept="video/*" onChange={onUpload} />
        </label>
      )}
      <span className="text-xs text-gray-500">WS: {connection}</span>

      <canvas ref={captureCanvasRef} className="hidden" />
    </div>
  );
}

export default memo(VideoTile);
