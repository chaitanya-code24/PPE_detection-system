"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, clearToken, getToken, isTokenExpired } from "@/lib/api";

type Row = { message: string; time: string };
type CameraEntry = { id: string; name: string; mode: "upload" | "live"; streaming: boolean };

type FilterMode = "all" | "violations" | "falls" | "compliant";

function classify(message: string): FilterMode {
  const m = message.toLowerCase();
  if (m.includes("fall")) return "falls";
  if (m.startsWith("no-")) return "violations";
  return "compliant";
}

export default function HistoryPage() {
  const router = useRouter();
  const [camera, setCamera] = useState("");
  const [cameras, setCameras] = useState<CameraEntry[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");

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
      setLoading(true);
      const token = getAuthToken();
      if (!token) {
        setLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/history?cam=${encodeURIComponent(camera)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) return handleAuthError();

      const data = await res.json();
      setRows(data.history ?? []);
      setLoading(false);
    };

    void loadHistory();
  }, [camera]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const kind = classify(row.message);
      const modeOk = mode === "all" || kind === mode;
      const queryOk = q.length === 0 || row.message.toLowerCase().includes(q);
      return modeOk && queryOk;
    });
  }, [mode, query, rows]);

  const groupedByMinute = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const row of filtered) {
      const key = row.time.slice(0, 5);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="mb-2 text-3xl font-semibold text-gray-900">Incident Journal</h1>
      <p className="mb-8 text-sm text-gray-600">
        Investigation-focused event timeline for post-incident review. Use Analytics for aggregate KPI summaries.
      </p>

      {cameras.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-600">No cameras found.</div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 lg:grid-cols-4">
            <select
              value={camera}
              onChange={(e) => setCamera(e.target.value)}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {cameras.map((cam) => (
                <option key={cam.id} value={cam.id}>
                  {cam.name} ({cam.mode})
                </option>
              ))}
            </select>

            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as FilterMode)}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All events</option>
              <option value="violations">Violations only</option>
              <option value="falls">Falls only</option>
              <option value="compliant">Compliant only</option>
            </select>

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search label (e.g. NO-Hardhat)"
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm"
            />

            <div className="flex items-center justify-end rounded bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Showing {filtered.length} / {rows.length} events
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Timeline (grouped by minute)</h2>

            {loading ? (
              <p className="py-8 text-center text-sm text-gray-500">Loading history...</p>
            ) : groupedByMinute.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">No events match your filters.</p>
            ) : (
              <div className="space-y-4">
                {groupedByMinute.map(([minute, items]) => (
                  <div key={minute} className="rounded border border-gray-100">
                    <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
                      {minute} ({items.length} event{items.length > 1 ? "s" : ""})
                    </div>
                    <div className="divide-y divide-gray-100">
                      {items.map((row, idx) => {
                        const kind = classify(row.message);
                        const tone =
                          kind === "falls"
                            ? "text-amber-700 bg-amber-50 border-amber-200"
                            : kind === "violations"
                              ? "text-red-700 bg-red-50 border-red-200"
                              : "text-emerald-700 bg-emerald-50 border-emerald-200";

                        return (
                          <div key={`${row.time}-${row.message}-${idx}`} className="flex items-center justify-between px-3 py-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span className={`rounded border px-2 py-0.5 text-xs font-medium ${tone}`}>{kind}</span>
                              <span className="text-gray-800">{row.message}</span>
                            </div>
                            <span className="font-mono text-xs text-gray-500">{row.time}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
