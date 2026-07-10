import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon. Keep it out of the bundler and let Node
  // require it at runtime. lib/db is imported only from the server entry, route
  // handlers, and the run supervisor — never from client components (KTD9).
  serverExternalPackages: ["better-sqlite3"],
  // Dev-only: allow requests from loopback hostnames other than the one the dev
  // server was started on. Under WSL2 a Windows browser reaches the dev server
  // as `localhost` while the server is bound to `127.0.0.1` (or vice-versa);
  // without these, Next blocks `/_next/...` client resources, React never
  // hydrates, and the dashboard stays stuck on "Discovering workflows…".
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;
