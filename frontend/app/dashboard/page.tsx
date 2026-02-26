"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import VideoTile from "@/components/VideoTile";
import LogsPanel from "@/components/LogsPanel";
import { API_BASE, getToken, clearToken, isTokenExpired } from "@/lib/api";
import DashboardSkeleton from "@/components/DashboardSkeleton";

export default function Dashboard() {
  const router = useRouter();
  const [logs, setLogs] = useState<any[]>([]);
  const [cameras, setCameras] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeStreams, setActiveStreams] = useState<Set<string>>(new Set());

  // Handle auth expiry
  const handleAuthError = () => {
    clearToken();
    router.push("/signin");
  };

  // Load cameras
  const fetchCameras = async () => {
    const token = getToken();

    if (isTokenExpired(token)) {
      handleAuthError();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/cameras`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401) {
        handleAuthError();
        return;
      }

      const data = await res.json();

      const cameraList = Array.isArray(data.cameras)
        ? data.cameras.map((c: any) => (typeof c === "string" ? c : c.name))
        : [];

      setCameras(cameraList);
    } catch (error) {
      console.error("Failed to fetch cameras:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  // Logs
  const addLog = (camera: string, message: string, time?: string) => {
    setLogs((prev) =>
      [
        { camera, message, time: time || new Date().toLocaleTimeString() },
        ...prev,
      ].slice(0, 100)
    );
  };

  // Camera removal
  const handleRemoveCamera = (camId: string) => {
    setCameras((prev) => prev.filter((cam) => cam !== camId));
  };

  // Streaming handling
  const handleStreamStart = (camId: string) => {
    setActiveStreams((prev) => new Set([...prev, camId]));
  };

  const handleStreamStop = (camId: string) => {
    setActiveStreams((prev) => {
      const next = new Set(prev);
      next.delete(camId);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      {/* Header */}
      <div className="mb-12">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Camera Dashboard
        </h1>
        <p className="text-gray-600">
          Monitor and manage your cameras in real-time
        </p>
      </div>

      {/* Loading */}
      {isLoading && <DashboardSkeleton />}

      {/* Cameras */}
      {!isLoading && cameras.length === 0 && (
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            <p className="text-gray-600 text-lg">No cameras configured yet</p>
            <p className="text-gray-500 text-sm mt-2">
              Go to Camera Management to add cameras
            </p>
          </div>
        </div>
      )}

      {!isLoading && cameras.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {cameras.map((cam) => (
            <div
              key={cam}
              className="transform transition-transform hover:scale-[1.02]"
            >
              <VideoTile
                camId={cam}
                addLog={addLog}
                onRemove={handleRemoveCamera}
                onStreamStart={handleStreamStart}
                onStreamStop={handleStreamStop}
              />
            </div>
          ))}
        </div>
      )}

      {/* Logs */}
      <LogsPanel logs={logs} />
    </div>
  );
}