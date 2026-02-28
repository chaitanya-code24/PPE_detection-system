"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "@/lib/api";

const navItems = [
  { name: "Dashboard", path: "/dashboard" },
  { name: "Health", path: "/health" },
  { name: "Analytics", path: "/analytics" },
  { name: "History", path: "/history" },
  { name: "Notifications", path: "/notifications" },
  { name: "Cameras", path: "/cameras" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    clearToken();
    router.push("/signin");
  };

  return (
    <div className="w-56 bg-white border-r border-gray-200 h-screen p-6 flex flex-col">
      {/* Logo/Brand */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900">
          PPE Monitor
        </h2>
        <p className="text-xs text-gray-500 mt-2">Detection System</p>
      </div>

      {/* Navigation */}
      <nav className="space-y-1 flex-1">
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`block px-4 py-2.5 rounded transition ${
                isActive
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Logout Button */}
      <button
        onClick={handleLogout}
        className="w-full px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded transform transition duration-150 ease-in-out hover:scale-[1.03] active:scale-95 font-semibold text-sm"
      >
        Sign Out
      </button>
    </div>
  );
}
