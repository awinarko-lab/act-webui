import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/runtime", () => ({
  getSupervisor: vi.fn(),
  getRunsRepo: vi.fn(),
}));

import { allowedOrigin } from "@/lib/api/origin-guard";
import type { RunsRepo } from "@/lib/db/runs-repo";
import type { RunRecord } from "@/lib/db/types";
import type { RunSupervisor } from "@/lib/runner/run-supervisor";
import type { RunRequest } from "@/lib/runner/types";
import { getRunsRepo, getSupervisor } from "@/lib/runtime";

import { POST } from "./route";

const mockedGetSupervisor = vi.mocked(getSupervisor);
const mockedGetRunsRepo = vi.mocked(getRunsRepo);

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    workflow: ".github/workflows/ci.yml",
    job: "build",
    event: "push",
    params: null,
    status: "passed",
    started_at: "2026-07-09T00:00:00.000Z",
    ended_at: "2026-07-09T00:01:00.000Z",
    duration_ms: 60000,
    ...overrides,
  };
}

function postReq(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/runs/${id}/rerun`, {
    method: "POST",
    headers: { origin: allowedOrigin() },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/runs/[id]/rerun", () => {
  it("creates a new run with the original workflow/job/event (AE9)", async () => {
    const original = makeRun();
    mockedGetRunsRepo.mockReturnValue({
      getRun: () => original,
    } as unknown as RunsRepo);

    const captured: RunRequest[] = [];
    const newRun = makeRun({ id: "run-2", status: "running" });
    mockedGetSupervisor.mockReturnValue({
      start: (req: RunRequest) => {
        captured.push(req);
        return newRun;
      },
    } as unknown as RunSupervisor);

    const res = await POST(postReq("run-1"), {
      params: Promise.resolve({ id: "run-1" }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ run: newRun });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      workflow: ".github/workflows/ci.yml",
      job: "build",
      event: "push",
    });
    // Re-run executes — dryRun is dropped.
    expect(captured[0].dryRun).toBeFalsy();
  });

  it("forwards the original run's params to the new run (AE9)", async () => {
    const params = { ref: "refs/heads/main", sha: "abc123" };
    const original = makeRun({ params });
    mockedGetRunsRepo.mockReturnValue({
      getRun: () => original,
    } as unknown as RunsRepo);

    const captured: RunRequest[] = [];
    const newRun = makeRun({ id: "run-2", status: "running" });
    mockedGetSupervisor.mockReturnValue({
      start: (req: RunRequest) => {
        captured.push(req);
        return newRun;
      },
    } as unknown as RunSupervisor);

    const res = await POST(postReq("run-1"), {
      params: Promise.resolve({ id: "run-1" }),
    });

    expect(res.status).toBe(201);
    expect(captured).toHaveLength(1);
    expect(captured[0].params).toEqual(params);
    // Re-run executes — dryRun is dropped.
    expect(captured[0].dryRun).toBeFalsy();
  });

  it("returns 404 when the original run does not exist", async () => {
    mockedGetRunsRepo.mockReturnValue({
      getRun: () => undefined,
    } as unknown as RunsRepo);
    const start = vi.fn();
    mockedGetSupervisor.mockReturnValue({
      start,
    } as unknown as RunSupervisor);

    const res = await POST(postReq("missing"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(res.status).toBe(404);
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request with 403", async () => {
    const start = vi.fn();
    mockedGetSupervisor.mockReturnValue({
      start,
    } as unknown as RunSupervisor);

    const res = await POST(
      new NextRequest("http://localhost/api/runs/run-1/rerun", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
      { params: Promise.resolve({ id: "run-1" }) },
    );

    expect(res.status).toBe(403);
    expect(start).not.toHaveBeenCalled();
  });
});
