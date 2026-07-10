import { NextResponse, type NextRequest } from "next/server";

import { assertSameOrigin } from "@/lib/api/origin-guard";
import { mapSupervisorError } from "@/lib/api/supervisor-errors";
import { getRunsRepo, getSupervisor } from "@/lib/runtime";
import { type RunRequest } from "@/lib/runner/types";

export const dynamic = "force-dynamic";

interface CreateRunBody {
  workflow?: string;
  job?: string | null;
  event?: string;
  dryRun?: boolean;
  params?: Record<string, unknown> | null;
}

// GET /api/runs — run history, most recent first (R10/R16).
export async function GET() {
  const repo = getRunsRepo();
  return NextResponse.json({ runs: repo.listRuns() });
}

// POST /api/runs — start a supervised run (R5/R7/R11, AE1).
//
// Input is sanitized and the environment probed before any row is persisted, so
// a bad identifier or missing prerequisite returns a diagnostic without leaving
// a `running` row behind.
export async function POST(request: NextRequest) {
  const guard = assertSameOrigin(request);
  if (guard) return guard;

  let body: CreateRunBody;
  try {
    body = (await request.json()) as CreateRunBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // A missing workflow coerces to "" so the supervisor's identifier validator
  // rejects it uniformly with an InvalidInvocationError (→ 400), rather than
  // special-casing the absence here.
  const req: RunRequest = {
    workflow: body.workflow ?? "",
    job: body.job ?? null,
    event: body.event,
    dryRun: body.dryRun,
    params: body.params ?? null,
  };

  try {
    const run = getSupervisor().start(req);
    return NextResponse.json({ run }, { status: 201 });
  } catch (e) {
    return mapSupervisorError(e);
  }
}
