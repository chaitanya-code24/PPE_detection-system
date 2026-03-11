"use client";

export default function InferenceLoadingOverlay({
  visible,
  label = "Waiting for detection engine...",
}: {
  visible: boolean;
  label?: string;
}) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 backdrop-blur-[1px]">
      <div className="flex items-center gap-3 rounded-full border border-white/15 bg-black/70 px-4 py-3 text-sm text-white shadow-lg">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        <span>{label}</span>
      </div>
    </div>
  );
}
