import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function decodeToken(token: string) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

function isTokenExpired(token: string | undefined) {
  if (!token) return true;
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return true;
  return decoded.exp * 1000 < Date.now();
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  const { pathname } = request.nextUrl;

  // Check if trying to access protected routes
  const isProtectedRoute = pathname.startsWith("/dashboard") ||
    pathname.startsWith("/analytics") ||
    pathname.startsWith("/history") ||
    pathname.startsWith("/cameras");

  // Redirect to login if:
  // 1. No token exists OR
  // 2. Token is expired
  if (isProtectedRoute && (!token || isTokenExpired(token))) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  // If user has valid token and is on auth pages, redirect to dashboard
  if (!isProtectedRoute && token && !isTokenExpired(token) && 
      (pathname === "/signin" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/analytics/:path*",
    "/history/:path*",
    "/cameras/:path*",
    "/signin",
    "/signup",
  ],
};


