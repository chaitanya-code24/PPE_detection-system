"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  API_BASE,
  getToken,
  clearToken,
  isTokenExpired,
} from "@/lib/api";

import FallAlert from "@/components/FallAlert";

// FallAlert imported from components/FallAlert (renders via portal)


export default function VideoTile({
  camId,
  addLog,
  onStreamStart,
  onStreamStop,
}: any) {
  const router = useRouter();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [hasStream, setHasStream] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [computeMode, setComputeMode] = useState<string | null>(null);

  const [fallAlertVisible, setFallAlertVisible] = useState(false);
  const stopAlarmRef = useRef<(() => void) | null>(null);

  const handleAuthError = () => {
    clearToken();
    router.push("/signin");
  };

  // ==========================
  // 🔊 ALARM PLAYER (10 sec)
  // ==========================
  const playAlarmFor10Seconds = () => {
    const audio = new Audio("/sounds/alarm.mp3"); // FIXED PATH
    audio.loop = true;
    audio.volume = 1.0;

    audio.play().catch(() => {
      console.warn("Autoplay blocked");
    });

    const stop = () => {
      audio.pause();
      audio.currentTime = 0;
    };

    setTimeout(stop, 10000);
    return stop;
  };

  // ==========================
  // 🧠 RESTORE STREAM STATUS
  // ==========================
  const checkStreamStatus = async () => {
    const token = getToken();
    if (!token || isTokenExpired(token)) return handleAuthError();

    const res = await fetch(`${API_BASE}/cameras`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json();
    const cam = data.cameras.find((c: any) =>
      typeof c === "string" ? c === camId : c.name === camId
    );

    if (cam && cam.streaming) startWS();
    else setHasStream(false);

    // fetch compute mode for display
    try {
      const res = await fetch(`${API_BASE}/compute_mode`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const j = await res.json();
        setComputeMode((j.compute || "").toUpperCase());
      }
    } catch (err) {
      console.warn("Failed to fetch compute mode", err);
    }
  };

  // ==========================
  // 🛰 START WEBSOCKET
  // ==========================
  const startWS = () => {
    const token = getToken();
    if (!token) return;

    const wsURL = `ws://127.0.0.1:8000/ws/video?cam=${camId}&token=${token}`;
    const ws = new WebSocket(wsURL);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setHasStream(true);
      onStreamStart?.(camId);
    };

    ws.onmessage = (event) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const blob = new Blob([event.data], { type: "image/jpeg" });
      const img = new Image();
      img.src = URL.createObjectURL(blob);

      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
      };
    };

    ws.onclose = () => {
      if (hasStream) setTimeout(startWS, 500);
    };
  };

  useEffect(() => {
    checkStreamStatus();
    return () => wsRef.current?.close();
  }, []);

  // ==========================
  // 📤 UPLOAD VIDEO
  // ==========================
  const uploadVideo = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);

    const token = getToken();
    if (isTokenExpired(token)) return handleAuthError();

    const formData = new FormData();
    formData.append("video", file);

    const res = await fetch(`${API_BASE}/upload?camId=${camId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (res.ok) {
      addLog(camId, "Video uploaded. Detection started.");
      startWS();
    }

    setIsUploading(false);
  };

  // ==========================
  // 🛑 STOP VIDEO
  // ==========================
  const stopVideo = async () => {
    const token = getToken();
    if (isTokenExpired(token)) return handleAuthError();

    setIsStopping(true);

    const res = await fetch(`${API_BASE}/stop?camId=${camId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      setHasStream(false);
      wsRef.current?.close();
      addLog(camId, "Video stopped.");
      onStreamStop?.(camId);
    }

    setIsStopping(false);
  };

  // ==========================
  // 🔄 POLL VIOLATIONS
  // ==========================
  const pollViolations = async () => {
    if (!hasStream) return;

    const token = getToken();
    if (isTokenExpired(token)) return handleAuthError();

    const res = await fetch(`${API_BASE}/violations?cam=${camId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return;

    const data = await res.json();
    if (!data.violations) return;

    data.violations.forEach((v: any) =>
      addLog(camId, v.message, v.time)
    );
  };

  useEffect(() => {
    if (!hasStream) return;
    const intv = setInterval(pollViolations, 500);
    return () => clearInterval(intv);
  }, [hasStream]);

  // ==========================
  // 🔥 FALL DETECTION POLL
  // ==========================
  const pollFallAlarm = async () => {
    if (!hasStream) return;

    const token = getToken();
    if (isTokenExpired(token)) return handleAuthError();

    const res = await fetch(`${API_BASE}/alarm?cam=${camId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return;

    const data = await res.json();
    if (!data.alarm) return;

    // show single alert instance and play alarm (do not add to global logs)
    if (!fallAlertVisible) {
      setFallAlertVisible(true);

      if (!stopAlarmRef.current) {
        stopAlarmRef.current = playAlarmFor10Seconds();
      }
    }
  };

  useEffect(() => {
    if (!hasStream) return;
    const intv = setInterval(pollFallAlarm, 500);
    return () => clearInterval(intv);
  }, [hasStream]);

  // Acknowledge alarm on user close (calls backend to prevent immediate re-alert)
  const acknowledgeAlarm = async () => {
    const token = getToken();
    if (!token || isTokenExpired(token)) return handleAuthError();

    try {
      await fetch(`${API_BASE}/alarm/acknowledge?cam=${camId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error("Failed to acknowledge alarm", err);
    }

    // stop audio and hide alert
    if (stopAlarmRef.current) {
      stopAlarmRef.current();
      stopAlarmRef.current = null;
    }
    setFallAlertVisible(false);
  };

  // ==========================
  // UI
  // ==========================
  return (
    <div className="relative">

      {/* 🟥 FALL ALERT POPUP */}
      <FallAlert
        visible={fallAlertVisible}
        onClose={acknowledgeAlarm}
      />

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-all duration-300">

        {/* Header */}
        <div className="px-6 py-4 border-b bg-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-gray-900">{camId}</span>

            {computeMode && (
              <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                {computeMode}
              </span>
            )}

            {hasStream && (
              <span className="px-3 py-1 text-xs rounded-full bg-green-50 text-green-700 border border-green-100">
                Live
              </span>
            )}
          </div>
        </div>

        {/* Video / Upload */}
        <div className="relative bg-gray-100 h-80 flex items-center justify-center">

          {hasStream ? (
            <>
              <canvas
                ref={canvasRef}
                width={640}
                height={480}
                className="w-full h-full object-cover"
              />

              <button
                onClick={stopVideo}
                disabled={isStopping}
                className="absolute top-4 right-4 bg-black text-white px-4 py-2 rounded shadow"
              >
                {isStopping ? "Stopping..." : "Stop"}
              </button>
            </>
          ) : (
            <label className="flex flex-col items-center justify-center h-full w-full border-2 border-dashed border-gray-300 cursor-pointer bg-white hover:bg-gray-50 transition">
              <div className="text-center">
                <span className="text-gray-700 font-medium block mb-1">
                  Upload video
                </span>
                <span className="text-gray-500 text-sm">
                  MP4, AVI, MOV
                </span>
              </div>

              <input hidden type="file" onChange={uploadVideo} />

              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                  <div className="spinner"></div>
                </div>
              )}
            </label>
          )}

        </div>
      </div>
    </div>
  );
}