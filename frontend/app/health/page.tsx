"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CameraHealthPanel from "@/components/CameraHealthPanel";
import { API_BASE, clearToken, getToken, isTokenExpired } from "@/lib/api";

type CameraMetric = {
  camera_id: string;
  streaming: boolean;
  ws_reconnects: number;
  uptime_sec: number;
  frames_received: number;
  frames_inferred: number;
  fps_in: number;
  fps_out: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  dropped_frames: number;
  queue_depth: number;
};

export default function HealthPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<CameraMetric[]>([]);

  const handleAuthError = () => {
    clearToken();
    router.push("/signin");
  };

  useEffect(() => {
    const fetchMetrics = async () => {
      const token = getToken();
      if (!token || isTokenExpired(token)) {
        handleAuthError();
        return;
      }

      const res = await fetch(`${API_BASE}/camera_metrics/all`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        handleAuthError();
        return;
      }

      if (!res.ok) return;

      const data = await res.json();
      setMetrics(Array.isArray(data.metrics) ? data.metrics : []);
    };

    void fetchMetrics();
    const id = window.setInterval(() => {
      void fetchMetrics();
    }, 2000);

    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900">Camera Health</h1>
        <p className="text-sm text-gray-600">Operational SLA metrics for all configured cameras.</p>
      </div>

      <CameraHealthPanel metrics={metrics} />
    </div>
  );
}
