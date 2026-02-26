"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, getToken, isTokenExpired } from "@/lib/api";
import MetadataRenderer from "@/components/MetadataRenderer";
import FallAlert from "@/components/FallAlert";
import { InferMetadata, createInferSocket, sendCanvasFrame } from "@/lib/wsClient";
import { clearLiveSession, getLiveSession, setLiveAutoStart, setLiveSession } from "@/lib/streamSession";

const SEND_INTERVAL_MS = 200;

type LiveCameraTileProps = {
  camId: string;
  title?: string;
  addLog?: (camera: string, message: string, time?: string) => void;
};

function LiveCameraTile({ camId, title, addLog }: LiveCameraTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rafRef = useRef<number | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const lastSentAtRef = useRef(0);
  const awaitingResultRef = useRef(false);
  const shouldRunRef = useRef(false);
  const acknowledgedFallRef = useRef(false);
  const lastLabelAtRef = useRef<Map<string, number>>(new Map());
  const fallTrueCountRef = useRef(0);
  const fallFalseCountRef = useRef(0);
  const lastPopupAtRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [metadata, setMetadata] = useState<InferMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAlert, setShowAlert] = useState(false);
  const showAlertRef = useRef(false);

  useEffect(() => {
    showAlertRef.current = showAlert;
  }, [showAlert]);
  
  const detachRuntime = useCallback(() => {
    shouldRunRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    awaitingResultRef.current = false;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopAll = useCallback(async () => {
    detachRuntime();
    clearLiveSession(camId);
    mediaRef.current = null;
    setLiveAutoStart(camId, false);

    setRunning(false);

    const token = getToken();
    if (token && !isTokenExpired(token)) {
      await fetch(`${API_BASE}/stop?camId=${encodeURIComponent(camId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
  }, [camId, detachRuntime]);

  const frameLoop = useCallback(async () => {
    if (!shouldRunRef.current) return;

    const video = videoRef.current;
    const ws = wsRef.current;
    const canvas = captureCanvasRef.current;

    if (video && ws && canvas) {
      const now = performance.now();
      if (
        now - lastSentAtRef.current >= SEND_INTERVAL_MS &&
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

  const startLive = useCallback(async () => {
    setError(null);

    const token = getToken();
    if (!token || isTokenExpired(token)) {
      setError("Session expired");
      return;
    }

    try {
      const existing = getLiveSession(camId);
      const stream =
        existing?.stream ?? (await navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
      mediaRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      shouldRunRef.current = true;
      setRunning(true);
      setLiveSession(camId, { stream, autoStart: true });

      wsRef.current = createInferSocket(camId, (incoming) => {
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
          !acknowledgedFallRef.current &&
          !showAlertRef.current &&
          cooldownPassed
        ) {
          setShowAlert(true);
          lastPopupAtRef.current = Date.now();
        }
        const logSource = incoming.events && incoming.events.length > 0 ? incoming.events : incoming.dets;
        for (const det of logSource) {
          const key = `${camId}:${det.label}`;
          const now = Date.now();
          const lastAt = lastLabelAtRef.current.get(key) ?? 0;
          if (now - lastAt > 1500) {
            addLog?.(camId, `${det.label} ${(det.conf * 100).toFixed(1)}%`);
            lastLabelAtRef.current.set(key, now);
          }
        }
      });
      wsRef.current.onclose = () => {
        awaitingResultRef.current = false;
      };

      void frameLoop();
    } catch {
      setError("Unable to access camera. Check browser camera permission.");
      await stopAll();
    }
  }, [addLog, camId, frameLoop, stopAll]);

  const resumeLive = useCallback(async () => {
    const existing = getLiveSession(camId);
    if (!existing || !existing.autoStart) return;

    mediaRef.current = existing.stream;
    if (videoRef.current) {
      videoRef.current.srcObject = existing.stream;
      await videoRef.current.play().catch(() => undefined);
    }

    shouldRunRef.current = true;
    setRunning(true);

    wsRef.current = createInferSocket(camId, (incoming) => {
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
        !acknowledgedFallRef.current &&
        !showAlertRef.current &&
        cooldownPassed
      ) {
        setShowAlert(true);
        lastPopupAtRef.current = Date.now();
      }
      const logSource = incoming.events && incoming.events.length > 0 ? incoming.events : incoming.dets;
      for (const det of logSource) {
        const key = `${camId}:${det.label}`;
        const now = Date.now();
        const lastAt = lastLabelAtRef.current.get(key) ?? 0;
        if (now - lastAt > 1500) {
          addLog?.(camId, `${det.label} ${(det.conf * 100).toFixed(1)}%`);
          lastLabelAtRef.current.set(key, now);
        }
      }
    });
    wsRef.current.onclose = () => {
      awaitingResultRef.current = false;
    };

    void frameLoop();
  }, [addLog, camId, frameLoop]);

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
    void resumeLive();
    return () => {
      setLiveAutoStart(camId, shouldRunRef.current);
      detachRuntime();
    };
  }, [camId, detachRuntime, resumeLive]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{camId} - Live Camera</h3>
          <p className="text-xs text-gray-500">{title ?? "Live inferencing source"}</p>
          <p className="text-xs text-gray-500">{running ? "Live inferencing" : "Idle"}</p>
        </div>
        {running ? (
          <button onClick={() => void stopAll()} className="rounded bg-gray-900 px-3 py-1.5 text-xs text-white hover:bg-black">
            Stop
          </button>
        ) : (
          <button onClick={() => void startLive()} className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700">
            Start Live
          </button>
        )}
      </div>

      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} className="h-full w-full object-contain" muted playsInline />
        <MetadataRenderer videoRef={videoRef} metadata={metadata} />
        <FallAlert visible={showAlert} onAcknowledge={() => void acknowledgeFall()} camera={camId} />
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <canvas ref={captureCanvasRef} className="hidden" />
    </div>
  );
}

export default memo(LiveCameraTile);
