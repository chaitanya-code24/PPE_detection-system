"use client";

import "./globals.css";
import Sidebar from "@/components/Sidebar";
import PageTransition from "@/components/PageTransition";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [initialFade, setInitialFade] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const pathname = usePathname();

  // Run only on first page load (pure white fade)
  useEffect(() => {
    const t = setTimeout(() => setInitialFade(false), 250);
    return () => clearTimeout(t);
  }, []);

  // Router-level loading overlay
  useEffect(() => {
    // Start loader instantly when path changes
    setRouteLoading(true);

    // Allow a small delay to show loader during page prep
    const t = setTimeout(() => setRouteLoading(false), 350);

    return () => clearTimeout(t);
  }, [pathname]);

  return (
    <html lang="en">
      <body className="bg-white text-gray-900">

        {/* Initial fade (first load only) */}
        {initialFade && <div className="page-transition-white" />}

        {/* White overlay every route change */}
        {routeLoading && (
          <div className="global-loading">
            <div className="loader"></div>
            <p className="text-gray-700 text-sm">Loading…</p>
          </div>
        )}

        {/* Page transition fade-out */}
        <PageTransition />

        <div className="flex h-screen">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-white">
            {children}
          </main>
        </div>

      </body>
    </html>
  );
}