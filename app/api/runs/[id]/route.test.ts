import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/runtime", () => ({
  getSupervisor: vi.fn(),
  getRunsRepo: vi.fn(),
}));

import type { RunsRepo } from "@/lib/db/runs-repo";
import type { RunLogLine, RunRecord, RunWithLogs } from "@/lib/db/types";
import { getRunsRepo } from "@/lib/runtime";

import { GET } from "./route";

const mockedGetRunsRepo = vi.mocked(getRunsRepo);

function makeRunWithLogs(): RunWithLogs {
  const run: RunRecord = {
    id: "run-1",
    workflow: ".github/workflows/ci.yml",
    job: null,
    event: "push",
    params: null,
    status: "passed",
    started_at: "2026-07-09T00:00:00.000Z",
    ended_at: "2026-07-09T00:01:00.000Z",
    duration_ms: 60000,
  };
  const logs: RunLogLine[] = [
    {
      run_id: "run-1",
      seq: 0,
      job: "build",
      step: "build",
      level: "info",
      message: "step 1 ok",
      ts: "2026-07-09T00:00:01.000Z",
    },
  ];
  return { run, logs };
}

function req(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/runs/${id}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/runs/[id]", () => {
  it("returns the run metadata and its full log", async () => {
    const withLogs = makeRunWithLogs();
    mockedGetRunsRepo.mockReturnValue({
      getRunWithLogs: (id: string) =>
        id === "run-1" ? withLogs : undefined,
    } as unknown as RunsRepo);

    const res = await GET(req("run-1"), { params: Promise.resolve({ id: "run-1" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(withLogs);
  });

  it("returns 404 when the run does not exist", async () => {
    mockedGetRunsRepo.mockReturnValue({
      getRunWithLogs: () => undefined,
    } as unknown as RunsRepo);

    const res = await GET(req("missing"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "run not found" });
  });
});
