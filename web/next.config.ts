import type { NextConfig } from "next";

// The Python server. The browser only ever talks to this Next.js app, which passes
// /api and /socket.io requests through, so the sign-in cookie stays first-party.
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const config: NextConfig = {
  turbopack: { root: import.meta.dirname }, // this folder, not the repo root (which has the old app's lockfile)
  skipTrailingSlashRedirect: true, // Socket.IO's address ends in "/"
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*", "*.local"], // phones on the same Wi-Fi during development
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/socket.io/", destination: `${backend}/socket.io/` },
    ];
  },
};

export default config;
