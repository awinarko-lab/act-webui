import { NextResponse } from "next/server";

import { discoverWorkflows } from "@/lib/discovery";

export const dynamic = "force-dynamic";

// GET /api/workflows — discovered workflow files + per-file parse errors (R1/R4).
export async function GET() {
  const { workflows, errors } = discoverWorkflows();
  return NextResponse.json({ workflows, errors });
}
