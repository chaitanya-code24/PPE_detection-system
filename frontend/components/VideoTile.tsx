"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, getToken, clearToken, isTokenExpired, startContinuousAlarm } from "@/lib/api";

export default function VideoTile({ camId, addLog, onRemove, onStreamStart, onStreamStop }: any) {
  const router = useRouter();
  const [hasStream, setHasStream] = useState(true);
  const [imgKey, setImgKey] = useState(0);
  const [isStopping, setIsStopping] = useState(false);
  const stopAlarmRef = useRef<(() => void) | null>(null);

  const handleAuthError = () => {
    clearToken();
    router.push("/signin");
  };

  const uploadVideo = async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("video", file);

    const token = getToken();

    // Check if token is expired
    if (isTokenExpired(token)) {
      handleAuthError();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/upload?camId=${camId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (res.status === 401) {
        handleAuthError();
        return;
      }

      if (!res.ok) {
        addLog(camId, "Upload failed.");
        return;
      }

      addLog(camId, "Video uploaded. Detection started.");
      setHasStream(true);
      // Notify parent that stream started
      if (onStreamStart) {
        onStreamStart(camId);
      }
    } catch (error) {
      console.error("Upload error:", error);
      addLog(camId, "Upload failed.");
    }
  };

  const handleError = () => {
    setHasStream(false);
  };

  const stopVideo = async () => {
    const token = getToken();
    if (isTokenExpired(token)) {
      handleAuthError();
      return;
    }

    setIsStopping(true);

    try {
      const res = await fetch(`${API_BASE}/stop?camId=${camId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401) {
        handleAuthError();
        return;
      }

      if (res.ok) {
        setHasStream(false);
        addLog(camId, "Video stopped and deleted.");
        // Notify parent that stream stopped
        if (onStreamStop) {
          onStreamStop(camId);
        }
        // Call parent callback to remove this tile
        if (onRemove) {
          onRemove(camId);
        }
      } else {
        const errorData = await res.json();
        addLog(camId, `Failed to stop video: ${errorData.detail || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Error stopping video:", error);
      addLog(camId, "Failed to stop video.");
    } finally {
      setIsStopping(false);
    }
  };

  const checkAlarm = async () => {
    const token = getToken();
    if (isTokenExpired(token)) {
      handleAuthError();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/alarm?cam=${camId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401) {
        handleAuthError();
        return;
      }

      if (res.ok) {
        const data = await res.json();
        if (data.alarm) {
          addLog(camId, "🚨 FALL DETECTED! 🚨");
          // Start continuous alarm for 10 seconds
          if (!stopAlarmRef.current) {
            stopAlarmRef.current = startContinuousAlarm(10000);
          }
        }
      }
    } catch (error) {
      console.error("Error checking alarm:", error);
    }
  };

  // Poll for alarms every 500ms when streaming
  useEffect(() => {
    if (!hasStream) return;

    const alarmInterval = setInterval(() => {
      checkAlarm();
    }, 500);

    return () => {
      clearInterval(alarmInterval);
      if (stopAlarmRef.current) {
        stopAlarmRef.current();
        stopAlarmRef.current = null;
      }
    };
  }, [hasStream]);

  return (
    <div className="relative">
      {/* Card Container */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        {/* Header */}
        <div className="bg-white px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <span className="text-gray-900 font-semibold">{camId}</span>
          {hasStream && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">Live</span>
          )}
        </div>

        {/* Video Area */}
        <div className="relative bg-gray-100">
          {hasStream ? (
            <>
              <img
                key={imgKey}
                src={`${API_BASE}/video_feed?cam=${camId}&t=${Date.now()}`}
                onError={handleError}
                className="w-full h-80 object-cover"
                decoding="async"
                loading="eager"
              />
              
              {/* Stop Button */}
              <button
                onClick={stopVideo}
                disabled={isStopping}
                className="absolute top-4 right-4 z-10 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-700 text-white px-4 py-2 rounded transform transition duration-150 ease-in-out hover:scale-[1.03] active:scale-95 font-semibold disabled:text-gray-400"
              >
                {isStopping ? "Stopping..." : "Stop"}
              </button>
            </>
          ) : (
            <label className="flex flex-col items-center justify-center h-80 border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 transition bg-gray-50">
              <div className="text-center">
                <span className="block text-gray-700 font-medium mb-1">Drop video here or click to upload</span>
                <span className="text-gray-500 text-sm">MP4, AVI, MOV</span>
              </div>
              <input 
                type="file" 
                hidden 
                onChange={uploadVideo}
                accept="video/*"
              />
            </label>
          )}
        </div>

        {/* Footer */}
        {hasStream && (
          <div className="bg-white px-6 py-3 border-t border-gray-100 text-xs text-gray-600">
            <span>Real-time detection active</span>
          </div>
        )}
      </div>
    </div>
  );
}
