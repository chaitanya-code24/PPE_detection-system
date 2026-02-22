"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";

export default function Signup() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const register = async () => {
    const res = await fetch(`${API_BASE}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      setError("User already exists");
      return;
    }

    router.push("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        {/* Main Card */}
        <div className="bg-white border border-gray-200 rounded-lg p-8 shadow-sm">
          {/* Header */}
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              Create Account
            </h2>
            <p className="text-gray-600 text-sm">Create new account to get started</p>
          </div>

          {/* Input Fields */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="text-gray-700 text-sm font-medium block mb-2">Username</label>
              <input
                className="w-full px-4 py-3 bg-white border border-gray-300 rounded text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-400 transition"
                placeholder="Choose a username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div>
              <label className="text-gray-700 text-sm font-medium block mb-2">Password</label>
              <input
                type="password"
                className="w-full px-4 py-3 bg-white border border-gray-300 rounded text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-400 transition"
                placeholder="Create a password"
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

          {/* Register Button */}
          <button
            onClick={register}
            className="w-full bg-gray-900 hover:bg-gray-800 text-white py-3 rounded transform transition duration-150 ease-in-out hover:scale-[1.03] active:scale-95 font-semibold mb-4"
          >
            Create Account
          </button>

          {/* Sign In Link */}
          <p className="text-center text-gray-600 text-sm">
            Already have an account?{" "}
            <a 
              href="/signin" 
              className="text-gray-900 hover:text-black font-semibold transition"
            >
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
