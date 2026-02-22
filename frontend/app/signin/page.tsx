"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";

export default function Signin() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const login = async () => {
    const res = await fetch(`${API_BASE}/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      setError("Invalid credentials");
      return;
    }

    const data = await res.json();
    // Set token cookie with 2 hour expiry (matching backend token expiry)
    document.cookie = `token=${data.access_token}; path=/; max-age=7200`;
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        {/* Main Card */}
        <div className="bg-white border border-gray-200 rounded-lg p-8 shadow-sm">
          {/* Header */}
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              Sign In
            </h2>
            <p className="text-gray-600 text-sm">Enter your credentials</p>
          </div>

          {/* Input Fields */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="text-gray-700 text-sm font-medium block mb-2">Username</label>
              <input
                className="w-full px-4 py-3 bg-white border border-gray-300 rounded text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-400 transition"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div>
              <label className="text-gray-700 text-sm font-medium block mb-2">Password</label>
              <input
                type="password"
                className="w-full px-4 py-3 bg-white border border-gray-300 rounded text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-400 transition"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {/* Login Button */}
          <button
            onClick={login}
            className="w-full bg-gray-900 hover:bg-gray-800 text-white py-3 rounded transform transition duration-150 ease-in-out hover:scale-[1.03] active:scale-95 font-semibold mb-4"
          >
            Sign In
          </button>

          {/* Sign Up Link */}
          <p className="text-center text-gray-600 text-sm">
            No account?{" "}
            <a 
              href="/signup" 
              className="text-gray-900 hover:text-black font-semibold transition"
            >
              Sign up
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
