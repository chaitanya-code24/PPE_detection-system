"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, clearToken, getToken, isTokenExpired } from "@/lib/api";

type CameraItem = {
  id: string;
  name: string;
  mode: "upload" | "live";
  streaming: boolean;
};

export default function CamerasPage() {
  const router = useRouter();
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [newCam, setNewCam] = useState("");
  const [newCamMode, setNewCamMode] = useState<"upload" | "live">("upload");
  const [error, setError] = useState<string | null>(null);

  const handleAuthError = () => {
    clearToken();
    router.push("/signin");
  };

  const tokenOrRedirect = () => {
    const token = getToken();
    if (!token || isTokenExpired(token)) {
      handleAuthError();
      return null;
    }
    return token;
  };

  const fetchCameras = async () => {
    const token = tokenOrRedirect();
    if (!token) return;

    const res = await fetch(`${API_BASE}/cameras`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) return handleAuthError();

    const data = await res.json();
    const next: CameraItem[] = Array.isArray(data.cameras)
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

    setCameras(next);
  };

  const addCamera = async () => {
    const name = newCam.trim();
    if (!name) return;

    const token = tokenOrRedirect();
    if (!token) return;

    const res = await fetch(
      `${API_BASE}/cameras?name=${encodeURIComponent(name)}&mode=${encodeURIComponent(newCamMode)}`,
      {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!res.ok) {
      setError("Failed to add camera. Name may already exist.");
      return;
    }

    setNewCam("");
    setError(null);
    await fetchCameras();
  };

  const deleteCamera = async (cameraId: string) => {
    const token = tokenOrRedirect();
    if (!token) return;

    const res = await fetch(`${API_BASE}/cameras/${encodeURIComponent(cameraId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      setError("Failed to delete camera.");
      return;
    }

    setError(null);
    await fetchCameras();
  };

  useEffect(() => {
    void fetchCameras();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="mb-2 text-3xl font-semibold text-gray-900">Camera Management</h1>
      <p className="mb-8 text-sm text-gray-600">Choose camera type first, then create it for dashboard/history/analytics.</p>

      <div className="mb-6 flex gap-3">
        <input
          value={newCam}
          onChange={(e) => setNewCam(e.target.value)}
          placeholder="camera-1"
          className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={newCamMode}
          onChange={(e) => setNewCamMode(e.target.value === "live" ? "live" : "upload")}
          className="rounded border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="upload">Upload Video</option>
          <option value="live">Live Camera</option>
        </select>
        <button onClick={() => void addCamera()} className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-black">
          Add
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cameras.map((cam) => (
          <div key={cam.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{cam.name}</h2>
                <p className="text-xs text-gray-500">{cam.mode === "live" ? "Live camera" : "Upload video"}</p>
              </div>
              <div className="flex gap-2">
                <span className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{cam.mode}</span>
                <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
                  {cam.streaming ? "active" : "idle"}
                </span>
              </div>
            </div>
            <button
              onClick={() => void deleteCamera(cam.id)}
              className="rounded border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
