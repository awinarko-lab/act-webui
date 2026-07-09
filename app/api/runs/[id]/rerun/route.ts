import { NextResponse, type NextRequest } from "next/server";

import { assertSameOrigin } from "@/lib/api/origin-guard";
import { getRunsRepo, getSupervisor } from "@/lib/runtime";
import {
  InvalidInvocationError,
  PreFlightError,
} from "@/lib/runner/types";

export const dynamic = "force-dynamic";

// POST /api/runs/[id]/rerun — start a new run with the original's parameters (AE9).
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
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (e) {
    if (e instanceof InvalidInvocationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof PreFlightError) {
      return NextResponse.json(
        { error: e.message, environment: e.details },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
