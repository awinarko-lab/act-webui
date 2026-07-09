import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon. Keep it out of the bundler and let Node
  // require it at runtime. lib/db is imported only from the server entry, route
  // handlers, and the run supervisor — never from client components (KTD9).
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
