"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

export default function AnalyticsPanel({ camId }: { camId: string }) {
  const [data, setData] = useState<any>(null);

  const getToken = () => {
    return document.cookie
      .split("; ")
      .find((row) => row.startsWith("token="))
      ?.split("=")[1];
  };

  useEffect(() => {
    const fetchAnalytics = async () => {
      const token = getToken();

      const res = await fetch(`${API_BASE}/analytics?cam=${camId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) return;

      const analytics = await res.json();
      setData(analytics);
    };

    fetchAnalytics();
  }, [camId]);

  if (!data) return null;

  return (
    <div className="w-full">
      <div className="bg-white rounded-lg p-8 border border-gray-200 shadow-sm">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Total Detections */}
          <div className="bg-gray-50 rounded-lg p-6 border border-gray-100 hover:border-gray-200 transition">
            <div>
              <p className="text-gray-600 text-sm font-medium mb-3">Total Detections</p>
              <p className="text-gray-900 text-3xl font-bold">{data.total_detections}</p>
            </div>
          </div>

          {/* Violations */}
          <div className="bg-gray-50 rounded-lg p-6 border border-gray-100 hover:border-gray-200 transition">
            <div>
              <p className="text-gray-600 text-sm font-medium mb-3">Violations</p>
              <p className="text-gray-900 text-3xl font-bold">{data.violations}</p>
            </div>
          </div>

          {/* Compliant */}
          <div className="bg-gray-50 rounded-lg p-6 border border-gray-100 hover:border-gray-200 transition">
            <div>
              <p className="text-gray-600 text-sm font-medium mb-3">Compliant</p>
              <p className="text-gray-900 text-3xl font-bold">{data.compliant}</p>
            </div>
          </div>

          {/* Violation Percentage */}
          <div className="bg-gray-50 rounded-lg p-6 border border-gray-100 hover:border-gray-200 transition">
            <div>
              <p className="text-gray-600 text-sm font-medium mb-3">Violation Rate</p>
              <p className="text-gray-900 text-3xl font-bold">{data.violation_percentage}%</p>
            </div>
          </div>
        </div>

        {/* Most Common Detection */}
        {data.most_common_label && (
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Most Common Detection</p>
            <p className="text-gray-900 text-lg font-semibold">{data.most_common_label}</p>
          </div>
        )}
      </div>
    </div>
  );
}
