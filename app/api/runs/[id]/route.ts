import { NextResponse, type NextRequest } from "next/server";

import { getRunsRepo } from "@/lib/runtime";

export const dynamic = "force-dynamic";

// GET /api/runs/[id] — run metadata plus the full persisted log (R17).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = getRunsRepo().getRunWithLogs(id);
  if (!result) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
