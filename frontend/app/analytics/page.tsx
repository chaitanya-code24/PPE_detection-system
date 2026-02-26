"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AnalyticsPanel from "@/components/AnalyticsPanel";
import AnalyticsSkeleton from "@/components/AnalyticsSkeleton";
import { API_BASE, getToken, clearToken, isTokenExpired } from "@/lib/api";

export default function AnalyticsPage() {
  const router = useRouter();
  const [cameras, setCameras] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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
    } catch (error) {
      console.error("Failed to fetch cameras:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      
      {/* Header */}
      <div className="mb-12">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Analytics Overview
        </h1>
        <p className="text-gray-600">
          View detailed detection analytics for your cameras
        </p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="space-y-12">
          <AnalyticsSkeleton />
          <AnalyticsSkeleton />
        </div>
      )}

      {/* No Cameras */}
      {!loading && cameras.length === 0 && (
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <p className="text-gray-600 text-lg mb-2">No cameras configured</p>
            <p className="text-gray-500 text-sm">
              Add cameras from the Camera Management page to view analytics
            </p>
          </div>
        </div>
      )}

      {/* Analytics Panels */}
      {!loading && cameras.length > 0 && (
        <div className="space-y-12">
          {cameras.map((cam) => (
            <div key={cam}>
              <h2 className="text-lg font-semibold text-gray-900 mb-6">{cam}</h2>
              <AnalyticsPanel key={cam} camId={cam} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}