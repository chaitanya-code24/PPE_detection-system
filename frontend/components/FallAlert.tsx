"use client";

import { useEffect, useRef } from "react";
import { startContinuousAlarm } from "@/lib/api";

export default function FallAlert({
  visible,
  onAcknowledge,
  camera,
}: {
  visible: boolean;
  onAcknowledge: () => void;
  camera: string;
}) {
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!visible) {
      stopRef.current?.();
      stopRef.current = null;
      return;
    }

    const audio = new Audio("/sounds/alarm.mp3");
    audio.loop = true;
    audio.volume = 1;
    let fallbackStop: (() => void) | null = null;
    audio.play().catch(() => {
      // Fall back to WebAudio beeps when media autoplay is blocked.
      fallbackStop = startContinuousAlarm(10_000);
    });

    const timeout = window.setTimeout(() => {
      audio.pause();
      audio.currentTime = 0;
    }, 10_000);

    stopRef.current = () => {
      window.clearTimeout(timeout);
      audio.pause();
      audio.currentTime = 0;
      fallbackStop?.();
    };

    return () => {
      window.clearTimeout(timeout);
      audio.pause();
      audio.currentTime = 0;
      fallbackStop?.();
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="absolute left-3 right-3 top-3 z-20 rounded-lg border border-red-300 bg-red-50 p-3 shadow">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-red-700">Fall detected</p>
          <p className="text-xs text-red-600">{camera} requires immediate acknowledgment.</p>
        </div>
        <button
          onClick={onAcknowledge}
          className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
        >
          Acknowledge
        </button>
      </div>
    </div>
  );
}
