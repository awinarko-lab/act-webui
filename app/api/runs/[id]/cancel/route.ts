import { NextResponse, type NextRequest } from "next/server";

import { assertSameOrigin } from "@/lib/api/origin-guard";
import { getRunsRepo, getSupervisor } from "@/lib/runtime";

export const dynamic = "force-dynamic";

// POST /api/runs/[id]/cancel — cancel a running run (R9).
//
// 404 when the run is unknown, 409 when it is not currently running (it may
// have exited naturally between the UI rendering the button and the request
// landing). cancel is terminal-once, so a late cancel after a natural exit is
// a safe no-op reflected here as 409.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = assertSameOrigin(request);
  if (guard) return guard;

  const { id } = await params;
  const repo = getRunsRepo();
  if (!repo.getRun(id)) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  const sup = getSupervisor();
  if (!sup.isRunning(id)) {
    return NextResponse.json(
      { error: "run is not currently running" },
      { status: 409 },
    );
  }
  const cancelled = sup.cancel(id);
  return NextResponse.json({ cancelled });
}
