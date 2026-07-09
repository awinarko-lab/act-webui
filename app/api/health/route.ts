import { NextResponse } from "next/server";
import { detectEnvironment } from "@/lib/env/act-detect";

export const dynamic = "force-dynamic";

// Returns act + container-runtime availability. Used by the UI's startup banner
// (R24/R25) and is also a liveness probe for the custom server.
export async function GET() {
  return NextResponse.json(detectEnvironment());
}
