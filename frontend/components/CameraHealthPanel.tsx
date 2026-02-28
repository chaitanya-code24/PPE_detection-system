"use client";

type Metric = {
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

function shortName(id: string): string {
  const parts = id.split("::");
  return parts.length === 2 ? parts[1] : id;
}

export default function CameraHealthPanel({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="mb-8 rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-900">Camera Health & SLA</h2>
        <p className="text-xs text-gray-500">FPS in/out, latency p50/p95, reconnect and frame-drop indicators.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Camera</th>
              <th className="px-4 py-3 text-left">State</th>
              <th className="px-4 py-3 text-right">FPS In</th>
              <th className="px-4 py-3 text-right">FPS Out</th>
              <th className="px-4 py-3 text-right">P50 (ms)</th>
              <th className="px-4 py-3 text-right">P95 (ms)</th>
              <th className="px-4 py-3 text-right">Dropped</th>
              <th className="px-4 py-3 text-right">Queue</th>
              <th className="px-4 py-3 text-right">Reconnects</th>
              <th className="px-4 py-3 text-right">Uptime</th>
            </tr>
          </thead>
          <tbody>
            {metrics.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-500">
                  No metrics available.
                </td>
              </tr>
            ) : (
              metrics.map((m) => (
                <tr key={m.camera_id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-900">{shortName(m.camera_id)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        m.streaming ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {m.streaming ? "Streaming" : "Idle"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{m.fps_in.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{m.fps_out.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{m.latency_p50_ms.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{m.latency_p95_ms.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{m.dropped_frames}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{m.queue_depth}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{m.ws_reconnects}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{Math.floor(m.uptime_sec)}s</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
