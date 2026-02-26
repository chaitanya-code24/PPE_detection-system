"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Toast from "@/components/Toast";
import { API_BASE, getToken, clearToken, isTokenExpired } from "@/lib/api";

export default function CamerasPage() {
  const router = useRouter();
  const [cameras, setCameras] = useState<Array<{name: string, streaming: boolean}>>([]);
  const [devices, setDevices] = useState<Array<{device:number,label:string}>>([]);
  const [discovering, setDiscovering] = useState(false);
  const [computeMode, setComputeMode] = useState<string | null>(null);
  const [newCam, setNewCam] = useState("");
  const [toast, setToast] = useState<{message: string, type: "success" | "error" | "warning" | "info"} | null>(null);

  const handleAuthError = () => {
    clearToken();
    router.push("/signin");
  };

  const fetchCameras = async () => {
    const token = getToken();

    // Check if token is expired
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

      if (!res.ok) return;

      const data = await res.json();
      // Handle both old format (array of strings) and new format (array of objects)
      const cameraList = Array.isArray(data.cameras)
        ? data.cameras.map((c: any) => typeof c === 'string' 
          ? {name: c, streaming: false} 
          : c)
        : [];
      setCameras(cameraList);
      // fetch compute mode
      try {
        const cm = await fetch(`${API_BASE}/compute_mode`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cm.ok) {
          const j = await cm.json();
          setComputeMode((j.compute || "").toUpperCase());
        }
      } catch (err) {
        console.warn("Failed to fetch compute mode", err);
      }
    } catch (error) {
      console.error("Failed to fetch cameras:", error);
    }
  };

  const discoverDevices = async () => {
    const token = getToken();
    if (isTokenExpired(token)) return handleAuthError();
    setDiscovering(true);
    try {
      const res = await fetch(`${API_BASE}/discover_devices?max_index=6`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return handleAuthError();
      if (!res.ok) return;
      const data = await res.json();
      setDevices(data.devices || []);
    } catch (err) {
      console.error("discover failed", err);
    } finally {
      setDiscovering(false);
    }
  };

  const startLocal = async (name: string, device: number) => {
    const token = getToken();
    if (isTokenExpired(token)) return handleAuthError();
    try {
      const res = await fetch(`${API_BASE}/start_local?name=${encodeURIComponent(name)}&device=${device}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return handleAuthError();
      if (!res.ok) {
        setToast({ message: "Failed to start local camera", type: "error" });
        return;
      }
      setToast({ message: "Local camera started", type: "success" });
      fetchCameras();
    } catch (err) {
      console.error(err);
      setToast({ message: "Failed to start local camera", type: "error" });
    }
  };

  const stopStream = async (name: string) => {
    const token = getToken();
    if (isTokenExpired(token)) return handleAuthError();
    try {
      const res = await fetch(`${API_BASE}/stop?camId=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return handleAuthError();
      setToast({ message: "Stream stopped", type: "success" });
      fetchCameras();
    } catch (err) {
      console.error(err);
      setToast({ message: "Failed to stop stream", type: "error" });
    }
  };

  const addCamera = async () => {
    if (!newCam) return;

    const token = getToken();

    // Check if token is expired
    if (isTokenExpired(token)) {
      handleAuthError();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/cameras?name=${newCam}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401) {
        handleAuthError();
        return;
      }

      setNewCam("");
      setToast({ message: "Camera added successfully!", type: "success" });
      fetchCameras();
    } catch (error) {
      console.error("Failed to add camera:", error);
      setToast({ message: "Failed to add camera", type: "error" });
    }
  };

  const deleteCamera = async (name: string) => {
    // Check if camera is streaming
    const camera = cameras.find(c => c.name === name);
    if (camera?.streaming) {
      setToast({ message: "⚠️ First stop the video before deleting", type: "warning" });
      return;
    }

    const token = getToken();

    // Check if token is expired
    if (isTokenExpired(token)) {
      handleAuthError();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/cameras/${name}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401) {
        handleAuthError();
        return;
      }

      setToast({ message: "Camera deleted successfully!", type: "success" });
      fetchCameras();
    } catch (error) {
      console.error("Failed to delete camera:", error);
      setToast({ message: "Failed to delete camera", type: "error" });
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50">
          <Toast 
            message={toast.message} 
            type={toast.type}
            onClose={() => setToast(null)}
          />
        </div>
      )}

      {/* Header */}
      <div className="mb-12">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Camera Management
        </h1>
        <p className="text-gray-600">Add and manage your cameras in one place</p>
      </div>

      {/* Add Camera Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-8 mb-12 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">
          Add New Camera
        </h2>
        <div className="flex gap-4">
          <input
            value={newCam}
            onChange={(e) => setNewCam(e.target.value)}
            placeholder="Enter camera name"
            className="flex-1 bg-white border border-gray-300 px-4 py-3 rounded text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-400 transition"
          />

          <button
            onClick={addCamera}
            className="bg-gray-900 hover:bg-gray-800 text-white px-6 py-3 rounded transform transition duration-150 ease-in-out hover:scale-[1.03] active:scale-95 font-semibold"
          >
            Add Screen
          </button>
          <button
            onClick={discoverDevices}
            className="ml-3 bg-white border border-gray-300 text-gray-900 px-4 py-3 rounded shadow-sm hover:shadow transition"
          >
            {discovering ? "Discovering..." : "Discover Devices"}
          </button>
        </div>
      </div>

      {/* Discovered Devices */}
      {devices.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8 shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Discovered Devices</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {devices.map((d) => (
              <div key={d.device} className="p-3 border rounded">
                <p className="text-sm text-gray-700">{d.label}</p>
                <p className="text-xs text-gray-500 mb-2">Index: {d.device}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => startLocal(newCam || `cam-${d.device}`, d.device)}
                    className="bg-gray-900 hover:bg-gray-800 text-white px-3 py-2 rounded text-sm"
                  >
                    Start Local (as {newCam || `cam-${d.device}`})
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cameras List */}
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">
          Configured Cameras ({cameras.length})
        </h2>

        {cameras.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-600 text-lg">No cameras added yet</p>
            <p className="text-gray-500 text-sm mt-2">Add your first camera above to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {cameras.map((cam) => (
              <div
                key={cam.name}
                className="bg-white border border-gray-200 rounded-lg p-6 transition hover:border-gray-300 shadow-sm"
              >
                {/* Camera Info */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">{cam.name}</h3>
                  <div className="flex items-center gap-2">
                    {computeMode && (
                      <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2 py-1 rounded-full border border-gray-100">
                        {computeMode}
                      </span>
                    )}
                    {cam.streaming && (
                      <span className="text-xs font-medium text-green-700 bg-green-50 px-3 py-1 rounded-full border border-green-100">
                        Streaming
                      </span>
                    )}
                  </div>
                </div>

                {/* Status */}
                <div className="mb-4 p-3 bg-gray-50 rounded border border-gray-100">
                  <p className="text-gray-700 text-sm">
                    Status: <span className={cam.streaming ? "text-green-700 font-medium" : "text-gray-600"}>
                      {cam.streaming ? "Active Stream" : "Idle"}
                    </span>
                  </p>
                </div>

                {/* Delete Button */}
                <button
                  onClick={() => deleteCamera(cam.name)}
                  disabled={cam.streaming}
                  className={`w-full py-2 rounded font-semibold transition ${
                    cam.streaming
                      ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                      : "bg-gray-900 hover:bg-gray-800 text-white transform transition duration-150 ease-in-out hover:scale-[1.03] active:scale-95"
                  }`}
                >
                  {cam.streaming ? "Stop Video First" : "Delete Camera"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
