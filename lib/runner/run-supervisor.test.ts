import { describe, it, expect, vi } from "vitest";
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
 * Synchronous test stream: emits 'data' on write() and 'end' on end()
 * synchronously (unlike PassThrough which defers 'end' to nextTick). This lets
 * tests assert finalization synchronously after proc.exit(), since the
 * supervisor flushes buffers on the stream 'end' event and finalizes on the
 * process 'close' event — both fire synchronously with this double.
 */
class SyncStream extends EventEmitter {
  write(chunk: string | Buffer): boolean {
    this.emit("data", chunk);
    return true;
  }
  end(): void {
    this.emit("end");
  }
}

/**
 * Test double for a spawned act process. `stdout`/`stderr` are SyncStreams (so
 * 'data' and 'end' are delivered synchronously on write/end). The process
 * itself is an EventEmitter the test drives with `exit(code, signal)`.
 *
 * `exit()` emits 'exit' then, if `autoClose` (default), ends the stdio streams
 * and emits 'close' — simulating a real child where stdio pipes close after
 * exit. Set `autoClose = false` to simulate data arriving after exit but before
 * stdio closes, then call `close()` manually.
 *
 * `kill()` defers the exit to `process.nextTick` so the caller (supervisor
 * `cancel`) can set state (e.g. `cancelRequested`) before finalization runs —
 * matching real async process behavior where kill() sends a signal and the
 * process exits sometime later.
 */
class FakeProcess extends EventEmitter {
  readonly stdout = new SyncStream();
  readonly stderr = new SyncStream();
  readonly pid: number;
  killed = false;
  lastKillSignal?: NodeJS.Signals;
  private exited = false;
  private closed = false;
  autoClose = true;

  constructor(pid = 4242) {
    super();
    this.pid = pid;
  }

  /** Drive the process 'exit' event (idempotent). If autoClose, also ends stdio
   * streams and emits 'close' synchronously. */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.emit("exit", code, signal);
    if (this.autoClose) {
      this.close();
    }
  }

  /** End stdio streams and emit 'close'. Call manually when autoClose is false. */
  close(): void {
    if (this.closed) return;
    this.stdout.end();
    this.stderr.end();
    this.closed = true;
    this.emit("close");
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.exited) return false;
    this.killed = true;
    this.lastKillSignal = signal;
    process.nextTick(() => this.exit(null, signal));
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

  it("cancel a running run → process killed, status cancelled, partial logs kept (AE7)", async () => {
    const { repo, sup, last } = setup();
    const run = sup.start({ workflow: ".github/workflows/ci.yml" });
    const proc = last();
    proc.stdout.write('{"msg":"partial line 1","jobID":"build","level":"info"}\n');

    const cancelled = sup.cancel(run.id);
    expect(cancelled).toBe(true);
    expect(proc.killed).toBe(true);
    expect(proc.lastKillSignal).toBe("SIGTERM");

    // kill() defers exit to nextTick so cancel() can set cancelRequested first.
    await new Promise((r) => process.nextTick(r));

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
  it("two runs coexist independently in the registry", async () => {
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

    // Cancel r2 (kill defers exit to nextTick).
    expect(sup.cancel(r2.id)).toBe(true);
    await new Promise((r) => process.nextTick(r));
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

describe("RunSupervisor code-review fixes", () => {
  it("cancel sets cancelRequested only when kill succeeds (C1)", () => {
    const { repo, sup, last } = setup();
    const run = sup.start({ workflow: ".github/workflows/ci.yml" });
    const proc = last();
    // Don't auto-close: exit emits 'exit' only, handle stays in registry.
    proc.autoClose = false;
    proc.exit(0); // natural exit — handle still registered (no 'close' yet)

    // kill() returns false (process already exited) → cancelRequested NOT set.
    expect(sup.cancel(run.id)).toBe(false);

    // Finalize — status is "passed" (exit 0), NOT "cancelled".
    proc.close();
    expect(repo.getRun(run.id)?.status).toBe("passed");
  });

  it("a stream 'error' event does not crash the supervisor (R6)", () => {
    const { repo, sup, last } = setup();
    const run = sup.start({ workflow: ".github/workflows/ci.yml" });
    const proc = last();
    proc.stdout.write('{"msg":"before error","jobID":"build","level":"info"}\n');

    // Suppress console.error from the error handler during this test.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Emit a pipe error on stdout — should be caught, not thrown.
    expect(() => proc.stdout.emit("error", new Error("EPIPE"))).not.toThrow();

    errSpy.mockRestore();

    // Supervisor survives — the run can still finalize normally.
    proc.exit(0);
    expect(repo.getRun(run.id)?.status).toBe("passed");
    const { logs } = repo.getRunWithLogs(run.id)!;
    expect(logs.some((l) => l.message === "before error")).toBe(true);
  });

  it("onClose resilience — if repo.updateStatus throws, handle is still removed (R5)", () => {
    const { repo, sup, last } = setup();
    const run = sup.start({ workflow: ".github/workflows/ci.yml" });

    const completeEvents: StatusEvent[] = [];
    sup.events.on("complete", (e: StatusEvent) => completeEvents.push(e));

    // Inject a repo whose updateStatus throws once.
    const errSpy = vi.spyOn(repo, "updateStatus").mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    // Suppress console.error from the catch block.
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const proc = last();
    proc.exit(0);

    logSpy.mockRestore();

    // The handle is removed even though updateStatus threw.
    expect(sup.isRunning(run.id)).toBe(false);
    expect(sup.activeCount()).toBe(0);
    // The 'complete' event still fires (R5: emits always run in finally).
    expect(completeEvents.length).toBe(1);
    expect(completeEvents[0]).toEqual({ runId: run.id, status: "passed" });

    errSpy.mockRestore();
  });

  it("trailing data after exit is captured, not dropped (C2)", () => {
    const { repo, sup, last } = setup();
    const run = sup.start({ workflow: ".github/workflows/ci.yml" });
    const proc = last();
    // Don't auto-close: simulate data arriving after exit but before stdio closes.
    proc.autoClose = false;

    proc.stdout.write('{"msg":"before exit","jobID":"build","level":"info"}\n');
    proc.exit(0); // 'exit' fires — supervisor stores code but does NOT finalize.

    // Data arrives after exit but before streams end — must not be dropped.
    proc.stdout.write('{"msg":"after exit","jobID":"build","level":"info"}\n');

    // Now stdio closes — supervisor flushes buffers and finalizes.
    proc.close();

    const { logs } = repo.getRunWithLogs(run.id)!;
    expect(logs.map((l) => l.message)).toEqual(["before exit", "after exit"]);
    expect(repo.getRun(run.id)?.status).toBe("passed");
  });
});
