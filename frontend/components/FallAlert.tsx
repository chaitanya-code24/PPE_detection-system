"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function FallAlert({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  if (!visible) return null;

  // guard for SSR
  if (typeof document === "undefined") return null;

  const el = (
    <div
      className="fixed top-6 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-4 rounded-xl shadow-2xl z-[9999] animate-fade-in flex items-center gap-4 pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="font-semibold">⚠️ FALL DETECTED — CHECK IMMEDIATELY</span>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="ml-4 bg-white text-red-600 font-bold px-3 py-1 rounded-lg hover:bg-gray-100"
      >
        Close
      </button>
    </div>
  );

  return createPortal(el, document.body);
}