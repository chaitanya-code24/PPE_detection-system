"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, getToken, clearToken, isTokenExpired } from "@/lib/api";
import HistorySkeleton from "@/components/HistorySkeleton";

export default function HistoryPage() {
  const router = useRouter();
  const [camera, setCamera] = useState<string>("");
  const [cameras, setCameras] = useState<string[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleAuthError = () => {
    clearToken();
    router.push("/signin");
  };

  const fetchCameras = async () => {
    const token = getToken();

    if (isTokenExpired(token)) {
      handleAuthError();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/cameras`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) return handleAuthError();

      const data = await res.json();
      const camList = Array.isArray(data.cameras)
        ? data.cameras.map((c: any) => (typeof c === "string" ? c : c.name))
        : [];

      setCameras(camList);

      if (camList.length > 0) setCamera(camList[0]);
    } catch (error) {
      console.error("Failed to fetch cameras:", error);
    }
  };

  const fetchHistory = async (selectedCam: string) => {
    if (!selectedCam) return;

    setLoading(true);

    const token = getToken();

    if (isTokenExpired(token)) {
      handleAuthError();
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/history?cam=${selectedCam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) return handleAuthError();

      const data = await res.json();
      setHistory(data.history || []);
    } catch (error) {
      console.error("Failed to fetch history:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  useEffect(() => {
    if (camera) fetchHistory(camera);
  }, [camera]);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      {/* Header */}
      <div className="mb-12">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Violation History
        </h1>
        <p className="text-gray-600">
          View all detected violations and events
        </p>
      </div>

      {cameras.length === 0 ? (
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <p className="text-gray-600 text-lg mb-2">No cameras configured</p>
            <p className="text-gray-500 text-sm">
              Add cameras from the Camera Management page to view history
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Camera Selector */}
          <div className="mb-8 bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
            <label className="text-gray-700 text-sm font-medium mr-4">
              Select Camera:
            </label>

            <select
              value={camera}
              onChange={(e) => setCamera(e.target.value)}
              className="bg-white border border-gray-300 text-gray-900 px-4 py-2 rounded focus:outline-none focus:border-gray-400 transition"
            >
              {cameras.map((cam) => (
                <option key={cam} value={cam}>
                  {cam}
                </option>
              ))}
            </select>
          </div>

          {/* History Table / Skeleton */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  Recent Records
                </h2>
                <span className="text-sm text-gray-600">{history.length} total</span>
              </div>
            </div>

            {loading ? (
              <HistorySkeleton />
            ) : history.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-gray-600 text-lg">No records found</p>
                <p className="text-gray-500 text-sm mt-2">
                  Violations will appear here as they are detected
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-6 py-3 text-gray-900 font-semibold">Camera</th>
                      <th className="text-left px-6 py-3 text-gray-900 font-semibold">Detection</th>
                      <th className="text-right px-6 py-3 text-gray-900 font-semibold">Time</th>
                    </tr>
                  </thead>

                  <tbody>
                    {history.map((item, index) => {
                      const isViolation = item.message.includes("NO-");
                      const isFall = item.message.includes("FALL");

                      return (
                        <tr
                          key={index}
                          className="border-t border-gray-100 hover:bg-gray-50 transition"
                        >
                          <td className="px-6 py-3">
                            <span className="text-gray-900 font-medium">
                              {camera}
                            </span>
                          </td>

                          <td className="px-6 py-3">
                            <span
                              className={`font-medium ${
                                isFall
                                  ? "text-gray-900"
                                  : isViolation
                                  ? "text-gray-900"
                                  : "text-gray-700"
                              }`}
                            >
                              {item.message}
                            </span>
                          </td>

                          <td className="px-6 py-3 text-right text-gray-600 font-mono text-xs">
                            {item.time}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && history.length > 0 && (
              <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 text-sm text-gray-600">
                Showing {history.length} records
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}