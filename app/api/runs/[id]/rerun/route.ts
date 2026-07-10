import { NextResponse, type NextRequest } from "next/server";

import { assertSameOrigin } from "@/lib/api/origin-guard";
import { mapSupervisorError } from "@/lib/api/supervisor-errors";
import { getRunsRepo, getSupervisor } from "@/lib/runtime";

export const dynamic = "force-dynamic";

// POST /api/runs/[id]/rerun — start a new run reusing the original's workflow,
// job, event, and trigger params (AE9).
//
// `dryRun` is intentionally dropped: a re-run executes (a previous dry-run's
// point was already to validate). 404 when the original run is unknown. The
// start may still fail at pre-flight if the environment changed since the
// original (e.g. act was removed) — mapped to 503, consistent with POST /api/runs.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = assertSameOrigin(request);
  if (guard) return guard;

  const { id } = await params;
  const repo = getRunsRepo();
  const original = repo.getRun(id);
  if (!original) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  try {
    const run = getSupervisor().start({
      workflow: original.workflow,
      job: original.job,
      event: original.event,
      params: original.params,
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (e) {
    return mapSupervisorError(e);
  }
}
