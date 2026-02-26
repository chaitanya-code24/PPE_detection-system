"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export default function PageTransition() {
  const pathname = usePathname();
  const [show, setShow] = useState(true);

  useEffect(() => {
    setShow(true);
    const timer = setTimeout(() => setShow(false), 200);
    return () => clearTimeout(timer);
  }, [pathname]);

  return show ? <div className="page-transition-white" /> : null;
}