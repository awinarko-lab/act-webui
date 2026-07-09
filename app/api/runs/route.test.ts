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
import {
  InvalidInvocationError,
  PreFlightError,
  type RunRequest,
} from "@/lib/runner/types";
import { getRunsRepo, getSupervisor } from "@/lib/runtime";

import { GET, POST } from "./route";

const mockedGetSupervisor = vi.mocked(getSupervisor);
const mockedGetRunsRepo = vi.mocked(getRunsRepo);

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
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
    ...overrides,
  };
}

function postReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/runs", () => {
  it("returns run history, most recent first", async () => {
    const runs = [makeRun(), makeRun({ id: "run-2", status: "passed" })];
    mockedGetRunsRepo.mockReturnValue({
      listRuns: () => runs,
    } as unknown as RunsRepo);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs });
    expect(mockedGetRunsRepo).toHaveBeenCalledOnce();
  });
});

describe("POST /api/runs", () => {
  it("starts the supervisor with the right args and returns the run (201)", async () => {
    const captured: RunRequest[] = [];
    const run = makeRun({ id: "new-run" });
    mockedGetSupervisor.mockReturnValue({
      start: (req: RunRequest) => {
        captured.push(req);
        return run;
      },
    } as unknown as RunSupervisor);

    const res = await POST(
      postReq(
        {
          workflow: ".github/workflows/ci.yml",
          job: "build",
          event: "push",
          dryRun: false,
        },
        { origin: allowedOrigin() },
      ),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ run });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      workflow: ".github/workflows/ci.yml",
      job: "build",
      event: "push",
      dryRun: false,
    });
  });

  it("maps a PreFlightError (act missing) to 503 and surfaces the environment (AE1)", async () => {
    const env = {
      act: { installed: false },
      container: { runtime: null, available: false },
    };
    mockedGetSupervisor.mockReturnValue({
      start: () => {
        throw new PreFlightError("act is not installed or not on PATH", env);
      },
    } as unknown as RunSupervisor);

    const res = await POST(
      postReq(
        { workflow: ".github/workflows/ci.yml" },
        { origin: allowedOrigin() },
      ),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "act is not installed or not on PATH",
      environment: env,
    });
  });

  it("maps an InvalidInvocationError to 400", async () => {
    mockedGetSupervisor.mockReturnValue({
      start: () => {
        throw new InvalidInvocationError("workflow", "workflow must match ...");
      },
    } as unknown as RunSupervisor);

    const res = await POST(
      postReq(
        { workflow: "../etc/passwd" },
        { origin: allowedOrigin() },
      ),
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/workflow must match/);
  });

  it("rejects a cross-origin request with 403 without touching the supervisor (KTD9)", async () => {
    const start = vi.fn();
    mockedGetSupervisor.mockReturnValue({
      start,
    } as unknown as RunSupervisor);

    const res = await POST(
      postReq(
        { workflow: ".github/workflows/ci.yml" },
        { origin: "https://evil.example" },
      ),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cross-origin request rejected" });
    expect(start).not.toHaveBeenCalled();
  });

  it("accepts a same-origin request that carries no Origin but a matching Host", async () => {
    const run = makeRun();
    const captured: RunRequest[] = [];
    mockedGetSupervisor.mockReturnValue({
      start: (req: RunRequest) => {
        captured.push(req);
        return run;
      },
    } as unknown as RunSupervisor);

    // allowedOrigin() defaults to http://127.0.0.1:3000 → authority 127.0.0.1:3000.
    const res = await POST(
      new NextRequest("http://127.0.0.1:3000/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:3000" },
        body: JSON.stringify({ workflow: ".github/workflows/ci.yml" }),
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ run });
    expect(captured).toHaveLength(1);
  });
});
