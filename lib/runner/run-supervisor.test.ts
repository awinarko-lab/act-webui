import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

import { openDatabase, type DB } from "../db/index";
import { RunsRepo } from "../db/runs-repo";
import type { EnvironmentInfo } from "../env/act-detect";
import { RunSupervisor } from "./run-supervisor";
import {
  PreFlightError,
  type LogStreamEvent,
  type Spawner,
  type StatusEvent,
  type SupervisedProcess,
} from "./types";

/**
 * Test double for a spawned act process. `stdout`/`stderr` are real PassThrough
 * streams (so 'data' is delivered synchronously on write); the process itself is
 * an EventEmitter the test drives with `exit(code, signal)`. `kill()` mimics a
 * signal kill by emitting exit(null, signal).
 */
class FakeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid: number;
  killed = false;
  lastKillSignal?: NodeJS.Signals;
  private exited = false;

  constructor(pid = 4242) {
    super();
    this.pid = pid;
  }

  /** Drive the process 'exit' event (idempotent). */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.emit("exit", code, signal);
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.exited) return false;
    this.killed = true;
    this.lastKillSignal = signal;
    this.exit(null, signal);
    return true;
  }
}

interface FakeSpawner {
  spawner: Spawner;
  procs: FakeProcess[];
  calls: Array<{ command: string; args: string[] }>;
  last: () => FakeProcess;
}

function makeFakeSpawner(): FakeSpawner {
  const procs: FakeProcess[] = [];
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawner: Spawner = (command, args) => {
    calls.push({ command, args: [...args] });
    const p = new FakeProcess();
    procs.push(p);
    return p as unknown as SupervisedProcess;
  };
  return { spawner, procs, calls, last: () => procs[procs.length - 1] };
}

const okEnv: EnvironmentInfo = {
  act: { installed: true, version: "0.2.89" },
  container: { runtime: "docker", available: true },
};

function setup(opts: { detect?: () => EnvironmentInfo } = {}) {
  const db: DB = openDatabase(":memory:");
  const repo = new RunsRepo(db);
  const fake = makeFakeSpawner();
  const detect = opts.detect ?? (() => okEnv);
  const sup = new RunSupervisor(repo, fake.spawner, detect, "/repo");
  return { db, repo, sup, ...fake };
}

describe("RunSupervisor lifecycle", () => {
  it("whole-workflow run: running → passed on exit 0, with logs retained (AE5)", () => {
    const { repo, sup, last } = setup();
    const run = sup.start({ workflow: ".github/workflows/ci.yml" });

    expect(run.status).toBe("running");
    expect(repo.getRun(run.id)?.status).toBe("running");
    expect(sup.isRunning(run.id)).toBe(true);
    expect(sup.activeCount()).toBe(1);

    const proc = last();
    proc.stdout.write(
      '{"msg":"step 1 ok","jobID":"build","step":"build","level":"info"}\n',
    );
    proc.stdout.write(
      '{"msg":"step 2 ok","jobID":"build","step":"test","level":"info"}\n',
    );
    proc.exit(0);

    expect(repo.getRun(run.id)?.status).toBe("passed");
    expect(sup.isRunning(run.id)).toBe(false);
    expect(sup.activeCount()).toBe(0);

    const { logs } = repo.getRunWithLogs(run.id)!;
    expect(logs.map((l) => l.message)).toEqual(["step 1 ok", "step 2 ok"]);
    expect(logs.every((l) => l.job === "build")).toBe(true);
    expect(logs.map((l) => l.seq)).toEqual([0, 1]);
  });

  it("non-zero exit → failed, logs retained (AE6)", () => {
    const { repo, sup, last } = setup();
    const run = sup.start({ workflow: ".github/workflows/ci.yml" });
    const proc = last();
    proc.stdout.write('{"msg":"starting","jobID":"build","level":"info"}\n');
    proc.stderr.write('{"msg":"boom","jobID":"build","level":"error"}\n');
    proc.exit(2);

    expect(repo.getRun(run.id)?.status).toBe("failed");
    const { logs } = repo.getRunWithLogs(run.id)!;
    expect(logs.map((l) => l.message)).toEqual(["starting", "boom"]);
    expect(logs[1].level).toBe("error");
  });

  it("cancel a running run → process killed, status cancelled, partial logs kept (AE7)", () => {
    const { repo, sup, last } = setup();
    const run = sup.start({ workflow: ".github/workflows/ci.yml" });
    const proc = last();
    proc.stdout.write('{"msg":"partial line 1","jobID":"build","level":"info"}\n');

    const cancelled = sup.cancel(run.id);
    expect(cancelled).toBe(true);
    expect(proc.killed).toBe(true);
    expect(proc.lastKillSignal).toBe("SIGTERM");

    // The signal-killed process exits null/non-zero, but cancel-intent wins.
    expect(repo.getRun(run.id)?.status).toBe("cancelled");
    expect(sup.isRunning(run.id)).toBe(false);

    const { logs } = repo.getRunWithLogs(run.id)!;
    expect(logs.some((l) => l.message === "partial line 1")).toBe(true);
  });

  it("cancel arriving after a natural exit 0 → status stays passed (no-op)", () => {
    const { repo, sup, last } = setup();
    const run = sup.start({ workflow: ".github/workflows/ci.yml" });
    const proc = last();
    proc.exit(0); // natural exit first → handle removed, status passed

    expect(repo.getRun(run.id)?.status).toBe("passed");
    expect(sup.cancel(run.id)).toBe(false); // unknown / already complete
    expect(repo.getRun(run.id)?.status).toBe("passed"); // unchanged
  });

  it("a JSON log line split across two stdout chunks parses into one event", () => {
    const { repo, sup, last } = setup();
    const run = sup.start({ workflow: ".github/workflows/ci.yml" });
    const proc = last();
    proc.stdout.write('{"msg":"split","jobID":"build","level":"info"'); // chunk 1
    proc.stdout.write("}\n"); // chunk 2 completes the line
    proc.exit(0);

    const { logs } = repo.getRunWithLogs(run.id)!;
    // Exactly one structured event — not two raw fragments.
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("split");
    expect(logs[0].job).toBe("build");
  });

  it("a trailing partial line (no newline) is flushed on exit", () => {
    const { repo, sup, last } = setup();
    const run = sup.start({ workflow: ".github/workflows/ci.yml" });
    const proc = last();
    proc.stdout.write('{"msg":"trailing","jobID":"build","level":"info"}'); // no \n
    proc.exit(0); // exit flushes the trailing line before writing status

    const { logs } = repo.getRunWithLogs(run.id)!;
    expect(logs.some((l) => l.message === "trailing")).toBe(true);
    expect(repo.getRun(run.id)?.status).toBe("passed");
  });
});

describe("RunSupervisor dry-run (AE3/AE4)", () => {
  it("valid workflow → --validate in the vector, status passed, valid reported (AE3)", () => {
    const { repo, sup, calls, last } = setup();
    const run = sup.start({
      workflow: ".github/workflows/ci.yml",
      dryRun: true,
    });

    // Vector carries --validate and no -j (whole-workflow dry-run).
    expect(calls[0].command).toBe("act");
    expect(calls[0].args).toContain("--validate");
    expect(calls[0].args).toContain("--json");
    expect(calls[0].args).not.toContain("-j");

    const proc = last();
    // act --validate writes its diagnostics to stderr and exits 0 when valid.
    proc.stderr.write(
      '{"level":"info","msg":"Using docker host unix:///var/run/docker.sock"}\n',
    );
    proc.exit(0);

    expect(repo.getRun(run.id)?.status).toBe("passed");
    const { logs } = repo.getRunWithLogs(run.id)!;
    expect(logs.some((l) => /valid/i.test(l.message))).toBe(true);
  });

  it("invalid workflow → invalid reported with the reason, status failed (AE4)", () => {
    const { repo, sup, last } = setup();
    const run = sup.start({
      workflow: ".github/workflows/ci.yml",
      dryRun: true,
    });
    const proc = last();
    proc.stderr.write(
      'Error: workflow is not valid. \'bad.yml\': yaml: line 1: did not find expected \',\' or \']\'\n',
    );
    proc.exit(1);

    expect(repo.getRun(run.id)?.status).toBe("failed");
    const { logs } = repo.getRunWithLogs(run.id)!;
    const summary = logs.find((l) => /invalid/i.test(l.message));
    expect(summary).toBeTruthy();
    expect(summary!.message).toMatch(/not valid/);
    expect(summary!.level).toBe("error");
  });

  it("dry-run proceeds without a container runtime available", () => {
    const detect = (): EnvironmentInfo => ({
      act: { installed: true, version: "0.2.89" },
      container: { runtime: null, available: false },
    });
    const { repo, sup, calls, last } = setup({ detect });
    const run = sup.start({
      workflow: ".github/workflows/ci.yml",
      dryRun: true,
    });
    expect(calls.length).toBe(1);
    expect(repo.getRun(run.id)?.status).toBe("running");
    last().exit(0);
    expect(repo.getRun(run.id)?.status).toBe("passed");
  });
});

describe("RunSupervisor fail-fast pre-flight (AE1)", () => {
  it("act missing → PreFlightError, no run row created, nothing spawned", () => {
    const detect = (): EnvironmentInfo => ({
      act: { installed: false },
      container: { runtime: "docker", available: true },
    });
    const { repo, sup, calls } = setup({ detect });
    expect(() =>
      sup.start({ workflow: ".github/workflows/ci.yml" }),
    ).toThrow(PreFlightError);
    expect(repo.listRuns().length).toBe(0);
    expect(calls.length).toBe(0);
    expect(sup.activeCount()).toBe(0);
  });

  it("container missing for a real run → PreFlightError, no run row", () => {
    const detect = (): EnvironmentInfo => ({
      act: { installed: true, version: "0.2.89" },
      container: { runtime: null, available: false },
    });
    const { repo, sup, calls } = setup({ detect });
    expect(() =>
      sup.start({ workflow: ".github/workflows/ci.yml" }),
    ).toThrow(PreFlightError);
    expect(repo.listRuns().length).toBe(0);
    expect(calls.length).toBe(0);
  });

  it("a non-allowlisted workflow is rejected before spawn (no row)", () => {
    const { repo, sup, calls } = setup();
    expect(() => sup.start({ workflow: "../etc/passwd" })).toThrow();
    expect(repo.listRuns().length).toBe(0);
    expect(calls.length).toBe(0);
  });
});

describe("RunSupervisor concurrency & events", () => {
  it("two runs coexist independently in the registry", () => {
    const { repo, sup, procs } = setup();
    const r1 = sup.start({ workflow: ".github/workflows/ci.yml" });
    const r2 = sup.start({
      workflow: ".github/workflows/deploy.yml",
      job: "deploy",
    });

    expect(sup.activeCount()).toBe(2);
    expect(sup.isRunning(r1.id)).toBe(true);
    expect(sup.isRunning(r2.id)).toBe(true);

    // Finish r1; r2 keeps running independently.
    procs[0].exit(0);
    expect(repo.getRun(r1.id)?.status).toBe("passed");
    expect(sup.isRunning(r1.id)).toBe(false);
    expect(sup.isRunning(r2.id)).toBe(true);
    expect(sup.activeCount()).toBe(1);

    // Cancel r2.
    expect(sup.cancel(r2.id)).toBe(true);
    expect(repo.getRun(r2.id)?.status).toBe("cancelled");
    expect(sup.activeCount()).toBe(0);
  });

  it("emits 'log' and 'complete' events for the realtime layer", () => {
    const { sup, last } = setup();
    const logEvents: LogStreamEvent[] = [];
    const statusEvents: StatusEvent[] = [];
    sup.events.on("log", (e: LogStreamEvent) => logEvents.push(e));
    sup.events.on("complete", (e: StatusEvent) => statusEvents.push(e));

    const run = sup.start({ workflow: ".github/workflows/ci.yml" });
    const proc = last();
    proc.stdout.write('{"msg":"hi","jobID":"build","level":"info"}\n');
    proc.exit(0);

    expect(logEvents.length).toBe(1);
    expect(logEvents[0].runId).toBe(run.id);
    expect(logEvents[0].line.message).toBe("hi");

    expect(statusEvents.length).toBe(1);
    expect(statusEvents[0]).toEqual({ runId: run.id, status: "passed" });
  });
});
