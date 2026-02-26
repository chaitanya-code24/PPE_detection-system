"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, clearToken, getToken, isTokenExpired } from "@/lib/api";

type Analytics = {
  camera: string;
  total_detections: number;
  violations: number;
  compliant: number;
  most_common_label: string | null;
  violation_percentage: number;
};

type CameraEntry = { id: string; name: string; mode: "upload" | "live"; streaming: boolean };

export default function AnalyticsPage() {
  const router = useRouter();
  const [cameras, setCameras] = useState<CameraEntry[]>([]);
  const [data, setData] = useState<Analytics[]>([]);

  const handleAuthError = () => {
    clearToken();
    router.push("/signin");
  };

  const getAuthToken = () => {
    const token = getToken();
    if (!token || isTokenExpired(token)) {
      handleAuthError();
      return null;
    }
    return token;
  };

  useEffect(() => {
    const load = async () => {
      const token = getAuthToken();
      if (!token) return;

      const camsRes = await fetch(`${API_BASE}/cameras`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (camsRes.status === 401) return handleAuthError();

      const camsJson = await camsRes.json();
      const camList: CameraEntry[] = Array.isArray(camsJson.cameras)
        ? camsJson.cameras.map((cam: any) =>
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

      setCameras(camList);

      const analytics = await Promise.all(
        camList.map(async (cam) => {
          const res = await fetch(`${API_BASE}/analytics?cam=${encodeURIComponent(cam.id)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) {
            return {
              camera: cam.id,
              total_detections: 0,
              violations: 0,
              compliant: 0,
              most_common_label: null,
              violation_percentage: 0,
            };
          }
          return (await res.json()) as Analytics;
        }),
      );

      setData(analytics);
    };

    void load();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="mb-2 text-3xl font-semibold text-gray-900">Analytics</h1>
      <p className="mb-8 text-sm text-gray-600">Detection quality and violation trends per camera.</p>

      {cameras.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-600">No cameras found.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.map((row) => (
            <div key={row.camera} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-base font-semibold text-gray-900">
                {cameras.find((c) => c.id === row.camera)?.name ?? row.camera}
                <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                  {cameras.find((c) => c.id === row.camera)?.mode ?? "upload"}
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">Total detections</p>
                  <p className="text-lg font-semibold text-gray-900">{row.total_detections}</p>
                </div>
                <div className="rounded bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">Violations</p>
                  <p className="text-lg font-semibold text-gray-900">{row.violations}</p>
                </div>
                <div className="rounded bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">Compliant</p>
                  <p className="text-lg font-semibold text-gray-900">{row.compliant}</p>
                </div>
                <div className="rounded bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">Violation %</p>
                  <p className="text-lg font-semibold text-gray-900">{row.violation_percentage}%</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-500">Most common label: {row.most_common_label ?? "-"}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
