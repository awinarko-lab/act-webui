import { NextResponse } from "next/server";
import { detectEnvironment, type EnvironmentInfo } from "@/lib/env/act-detect";

export const dynamic = "force-dynamic";

// Returns act + container-runtime availability. Used by the UI's startup banner
// (R24/R25) and is also a liveness probe for the custom server.
//
// `detectEnvironment` spawnSyncs `act --version` + `docker info` (each up to
// ~15s) on every call. The route is unauthenticated, so without caching a
// drive-by page hitting GET repeatedly could starve the event loop (S2). The
// result is cached for a short TTL so repeated rapid GETs don't re-spawn.

const ENV_CACHE_TTL_MS = 5_000;
let envCache: EnvironmentInfo | null = null;
let envCacheAt = 0;

function getEnvironment(): EnvironmentInfo {
  const now = Date.now();
  if (envCache !== null && now - envCacheAt < ENV_CACHE_TTL_MS) {
    return envCache;
  }
  envCache = detectEnvironment();
  envCacheAt = now;
  return envCache;
}

/** Reset the environment cache. Exposed for tests. @internal */
export function __resetEnvCache(): void {
  envCache = null;
  envCacheAt = 0;
}

export async function GET() {
  return NextResponse.json(getEnvironment());
}
