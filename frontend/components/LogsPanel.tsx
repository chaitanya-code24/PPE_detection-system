"use client";

export default function LogsPanel({ logs }: { logs: any[] }) {
  return (
    <div className="w-full">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
        {/* Header */}
        <div className="bg-white px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            Detection Logs
          </h2>
          <p className="text-gray-600 text-sm mt-1">{logs.length} event{logs.length !== 1 ? "s" : ""}</p>
        </div>

        {/* Logs Container */}
        <div className="max-h-96 overflow-y-auto">
          {logs.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-600">No detections yet</p>
              <p className="text-sm text-gray-500 mt-2">Upload a video to start</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {logs.map((log, index) => {
                const isFall = log.message.includes("FALL");
                const isViolation = log.message.includes("NO-");

                return (
                  <div
                    key={index}
                    className="px-6 py-3 transition-all hover:bg-gray-50 border-l-2 border-gray-100"
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-600 mb-1">
                          {log.camera}
                        </div>
                        <p className="text-gray-900 text-sm break-words font-medium">
                          {log.message}
                        </p>
                      </div>
                      <div className="text-gray-500 text-xs whitespace-nowrap flex-shrink-0 font-mono">
                        {log.time}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {logs.length > 0 && (
          <div className="bg-white px-6 py-3 border-t border-gray-100 text-sm text-gray-600 flex justify-between">
            <span>Total: {logs.length}</span>
            <span>Latest: {logs[0]?.time}</span>
          </div>
        )}
      </div>
    </div>
  );
}
