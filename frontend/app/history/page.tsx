"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, clearToken, getToken, isTokenExpired } from "@/lib/api";

type Row = { message: string; time: string };
type CameraEntry = { id: string; name: string; mode: "upload" | "live"; streaming: boolean };

export default function HistoryPage() {
  const router = useRouter();
  const [camera, setCamera] = useState("");
  const [cameras, setCameras] = useState<CameraEntry[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

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

      const res = await fetch(`${API_BASE}/cameras`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) return handleAuthError();

      const data = await res.json();
      const camList: CameraEntry[] = Array.isArray(data.cameras)
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

      setCameras(camList);
      if (camList.length) setCamera(camList[0].id);
    };

    void load();
  }, []);

  useEffect(() => {
    if (!camera) return;

    const loadHistory = async () => {
      const token = getAuthToken();
      if (!token) return;

      const res = await fetch(`${API_BASE}/history?cam=${encodeURIComponent(camera)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) return handleAuthError();

      const data = await res.json();
      setRows(data.history ?? []);
    };

    void loadHistory();
  }, [camera]);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="mb-2 text-3xl font-semibold text-gray-900">Detection History</h1>
      <p className="mb-8 text-sm text-gray-600">Metadata timeline from YOLO inference events.</p>

      {cameras.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-600">No cameras found.</div>
      ) : (
        <>
          <select
            value={camera}
            onChange={(e) => setCamera(e.target.value)}
            className="mb-6 rounded border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {cameras.map((cam) => (
              <option key={cam.id} value={cam.id}>
                {cam.name} ({cam.mode})
              </option>
            ))}
          </select>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Camera</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Label</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={`${row.time}-${idx}`} className="border-t border-gray-100">
                    <td className="px-4 py-3 text-gray-800">
                      {cameras.find((c) => c.id === camera)?.name ?? camera}
                    </td>
                    <td className="px-4 py-3 text-gray-800">{row.message}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-gray-600">{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
