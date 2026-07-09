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
import { getRunsRepo, getSupervisor } from "@/lib/runtime";

import { POST } from "./route";

const mockedGetSupervisor = vi.mocked(getSupervisor);
const mockedGetRunsRepo = vi.mocked(getRunsRepo);

function makeRun(): RunRecord {
  return {
    id: "run-1",
    workflow: ".github/workflows/ci.yml",
    job: null,
    event: "push",
    params: null,
    status: "running",
    started_at: "2026-07-09T00:00:00.000Z",
    ended_at: null,
    duration_ms: null,
  };
}

function postReq(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/runs/${id}/cancel`, {
    method: "POST",
    headers: { origin: allowedOrigin() },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/runs/[id]/cancel", () => {
  it("cancels a running run and reports it", async () => {
    mockedGetRunsRepo.mockReturnValue({
      getRun: () => makeRun(),
    } as unknown as RunsRepo);
    const cancel = vi.fn(() => true);
    mockedGetSupervisor.mockReturnValue({
      isRunning: () => true,
      cancel,
    } as unknown as RunSupervisor);

    const res = await POST(postReq("run-1"), {
      params: Promise.resolve({ id: "run-1" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true });
    expect(cancel).toHaveBeenCalledWith("run-1");
  });

  it("returns 404 when the run does not exist", async () => {
    mockedGetRunsRepo.mockReturnValue({
      getRun: () => undefined,
    } as unknown as RunsRepo);
    const cancel = vi.fn();
    mockedGetSupervisor.mockReturnValue({
      isRunning: () => false,
      cancel,
    } as unknown as RunSupervisor);

    const res = await POST(postReq("missing"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(res.status).toBe(404);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("returns 409 when the run exists but is not currently running", async () => {
    mockedGetRunsRepo.mockReturnValue({
      getRun: () => makeRun(),
    } as unknown as RunsRepo);
    const cancel = vi.fn();
    mockedGetSupervisor.mockReturnValue({
      isRunning: () => false,
      cancel,
    } as unknown as RunSupervisor);

    const res = await POST(postReq("run-1"), {
      params: Promise.resolve({ id: "run-1" }),
    });

    expect(res.status).toBe(409);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request with 403", async () => {
    const cancel = vi.fn();
    mockedGetSupervisor.mockReturnValue({
      isRunning: () => true,
      cancel,
    } as unknown as RunSupervisor);

    const res = await POST(
      new NextRequest("http://localhost/api/runs/run-1/cancel", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
      { params: Promise.resolve({ id: "run-1" }) },
    );

    expect(res.status).toBe(403);
    expect(cancel).not.toHaveBeenCalled();
  });
});
