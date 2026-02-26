"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LiveCameraTile from "@/components/LiveCameraTile";
import LogsPanel from "@/components/LogsPanel";
import VideoTile from "@/components/VideoTile";
import { API_BASE, clearToken, getToken, isTokenExpired } from "@/lib/api";

type CameraMode = "upload" | "live";
type CameraEntry = { id: string; name: string; mode: CameraMode; streaming: boolean };

type DashboardLog = {
  camera: string;
  message: string;
  time: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [cameras, setCameras] = useState<CameraEntry[]>([]);
  const [logs, setLogs] = useState<DashboardLog[]>([]);

  const handleAuthError = () => {
    clearToken();
    router.push("/signin");
  };

  const addLog = useCallback((camera: string, message: string, time?: string) => {
    setLogs((prev) => [{ camera, message, time: time ?? new Date().toLocaleTimeString() }, ...prev].slice(0, 150));
  }, []);

  const fetchCameras = async () => {
    const token = getToken();
    if (!token || isTokenExpired(token)) {
      handleAuthError();
      return;
    }

    const res = await fetch(`${API_BASE}/cameras`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      handleAuthError();
      return;
    }

    const data = await res.json();
    const list: CameraEntry[] = Array.isArray(data.cameras)
      ? data.cameras.map((cam: any) =>
          typeof cam === "string"
            ? { id: cam, name: cam, mode: "upload", streaming: false }
            : {
                id: cam.id ?? cam.name,
                name: cam.name ?? cam.id,
                mode: cam.mode === "live" ? "live" : "upload",
                streaming: !!cam.streaming,
              },
        )
      : [];
    setCameras(list);
  };

  useEffect(() => {
    void fetchCameras();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900">A-3 Monitoring Dashboard</h1>
        <p className="text-sm text-gray-600">Local video on device, metadata-only inference over WebSocket.</p>
      </div>

      {cameras.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-600">
          No cameras configured. Create cameras in Camera Management first.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {cameras.map((cam) => (
            <div key={cam.id} className="h-full">
              {cam.mode === "upload" ? (
                <VideoTile camId={cam.id} title={`${cam.name} (Upload)`} addLog={addLog} />
              ) : (
                <LiveCameraTile camId={cam.id} title={`${cam.name} (Live)`} addLog={addLog} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <LogsPanel logs={logs} />
      </div>
    </div>
  );
}
