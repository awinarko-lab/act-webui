import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import { detectEnvironment, type EnvironmentInfo } from "../env/act-detect";
import { RunsRepo } from "../db/runs-repo";
import type { RunRecord, RunStatus } from "../db/types";
import { buildInvocation, interpretValidation } from "./act-invocation";
import { LineBuffer, parseLine } from "./log-parser";
import {
  PreFlightError,
  type LogStreamEvent,
  type ParsedLogEvent,
  type RunRequest,
  type SpawnOptions,
  type Spawner,
  type StatusEvent,
  type SupervisedProcess,
} from "./types";

/** Directory act runs in. Overridable via ACT_REPO_PATH; defaults to cwd. */
export function repoRoot(): string {
  return process.env.ACT_REPO_PATH || process.cwd();
}

/**
 * Default spawner: runs act in its own process group (`detached: true`) so a
 * cancel can kill the whole tree with a negative-pid signal. Translates a spawn
 * `error` event (e.g. ENOENT, if act vanishes between pre-flight and spawn) into
 * a synthetic non-zero exit so the supervisor's exit-only contract still holds.
 */
export function createDefaultSpawner(): Spawner {
  return (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ): SupervisedProcess => new ChildProcessAdapter(
    spawn(command, [...args], {
      cwd: options.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

/** Adapts a ChildProcess to {@link SupervisedProcess} with group-kill semantics. */
class ChildProcessAdapter extends EventEmitter {
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly pid: number;
  private settled = false;

  constructor(child: ChildProcess) {
    super();
    this.stdout = child.stdout as NodeJS.ReadableStream;
    this.stderr = child.stderr as NodeJS.ReadableStream;
    this.pid = child.pid ?? -1;

    child.on("exit", (code, signal) => {
      this.settled = true;
      this.emit("exit", code ?? null, signal ?? null);
    });
    child.on("error", () => {
      if (!this.settled) {
        this.settled = true;
        this.emit("exit", 127, null);
      }
    });
    // 'close' fires after stdio streams have ended — the safe point to
    // finalize (trailing log data has all been delivered). Always emits,
    // even after an 'error' event.
    child.on("close", (code, signal) => {
      if (!this.settled) {
        this.settled = true;
        this.emit("exit", code ?? null, signal ?? null);
      }
      this.emit("close");
    });
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.pid <= 0) return false;
    try {
      // Negative pid = signal the whole process group (detached: true).
      process.kill(-this.pid, signal);
      return true;
    } catch {
      // Already reaped (ESRCH) or insufficient permissions.
      return false;
    }
  }
}

/** Internal registry entry for a live run. */
interface RunHandle {
  runId: string;
  process: SupervisedProcess;
  /** Set only when cancel()'s kill() succeeds; takes precedence over exit code. */
  cancelRequested: boolean;
  /** True for dry-run (`act --validate`) runs. */
  dryRun: boolean;
  /** Captured stderr messages, used to derive a dry-run validity reason. */
  stderrLines: string[];
  /** Flush callbacks for each stream's line buffer (idempotent, called on close). */
  readers: Array<{ flush: () => void }>;
  /** Exit code captured on the 'exit' event; null until then or if signal-killed. */
  exitCode: number | null;
  /** Guards against double-finalization (close can fire after a stream error). */
  finalized: boolean;
  /** Pending SIGKILL escalation timer (R1); cleared on close. */
  killTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Spawns and supervises `act` runs: builds the invocation, captures and parses
 * output, derives terminal status, supports cancel, and rejects triggers when
 * prerequisites are missing.
 *
 * Status is **cancel-intent-first** and written **once**: if cancel was
 * requested for the run, the status is `cancelled` regardless of exit code (a
 * signal-killed act exits null/non-zero); otherwise exit 0 → `passed`, else
 * `failed`. The repository's `updateStatus` is itself terminal-once, so a cancel
 * arriving after a natural exit is a safe no-op.
 *
 * Concurrency is unbounded: an in-process registry maps run id → live process,
 * so many runs coexist. Cancel kills the process group.
 *
 * An {@link EventEmitter} ({@link events}) emits `log` ({@link LogStreamEvent}),
 * `status`, and `complete` ({@link StatusEvent}) so a future realtime layer
 * (Socket.io) can subscribe.
 */
export class RunSupervisor {
  readonly events = new EventEmitter();
  private readonly registry = new Map<string, RunHandle>();

  constructor(
    private readonly repo: RunsRepo,
    private readonly spawner: Spawner = createDefaultSpawner(),
    private readonly detect: () => EnvironmentInfo = detectEnvironment,
    private readonly cwd: string = repoRoot(),
  ) {}

  /**
   * Start (and supervise) a run.
   *
   * Order matters: input is sanitized and the environment is probed **before**
   * any row is persisted, so a bad identifier (InvalidInvocationError) or missing
   * prerequisite (PreFlightError) leaves no `running` row behind (R11/AE1).
   */
  start(req: RunRequest): RunRecord {
    // 1. Sanitize identifiers and build the arg vector (throws before any row).
    const args = buildInvocation(req);

    // 2. Pre-flight availability (throws before any row).
    const env = this.detect();
    if (!env.act.installed) {
      throw new PreFlightError("act is not installed or not on PATH", env);
    }
    // A dry-run runs `act --validate` (no container); only real runs need a
    // runtime, so AE3 works on a machine without docker/podman available.
    if (!req.dryRun && !env.container.available) {
      throw new PreFlightError(
        "no container runtime is available (docker/podman)",
        env,
      );
    }

    // 3. Persist the running row.
    const run = this.repo.insertRun({
      workflow: req.workflow,
      job: req.job ?? null,
      event: req.event ?? "push",
      params: req.params ?? null,
    });

    // 4. Spawn in its own process group and register.
    const process = this.spawner("act", args, { cwd: this.cwd });
    const handle: RunHandle = {
      runId: run.id,
      process,
      cancelRequested: false,
      dryRun: !!req.dryRun,
      stderrLines: [],
      readers: [],
      exitCode: null,
      finalized: false,
    };
    this.registry.set(run.id, handle);

    // 5. Wire line-buffered streams (UTF-8 safe across chunk boundaries).
    this.attachStream(run.id, process.stdout, "stdout", handle);
    this.attachStream(run.id, process.stderr, "stderr", handle);

    // 6. 'exit' captures the code; 'close' (fires after stdio ends) triggers
    //    finalization so trailing log lines arriving after 'exit' are not
    //    dropped (C2). Cancel-intent takes precedence over the exit code.
    process.on("exit", (code) => {
      handle.exitCode = code;
    });
    process.on("close", () => this.onClose(run.id, handle));

    return run;
  }

  /**
   * Cancel a running run. Signals the process group with SIGTERM and, only if
   * the kill succeeded, sets the cancel-intent flag (C1 — so a run that already
   * exited naturally isn't mislabeled cancelled). Schedules a forced SIGKILL
   * escalation after a grace period (R1), cleared on close. Returns false if the
   * run is unknown or already complete.
   */
  cancel(runId: string): boolean {
    const handle = this.registry.get(runId);
    if (!handle) return false;
    // C1: set cancelRequested ONLY when kill succeeds, so a run that already
    // exited naturally (kill returns false) is not mislabeled cancelled.
    const killed = handle.process.kill("SIGTERM");
    if (killed) {
      handle.cancelRequested = true;
      // R1: escalate to SIGKILL after a grace period if the process hasn't exited.
      handle.killTimer = setTimeout(() => {
        try {
          handle.process.kill("SIGKILL");
        } catch {
          // Already reaped (ESRCH) or permissions — safe to ignore.
        }
      }, 5000);
    }
    return killed;
  }

  /** True while the run is being supervised (before its terminal exit). */
  isRunning(runId: string): boolean {
    return this.registry.has(runId);
  }

  /** Number of runs currently being supervised (no concurrency cap). */
  activeCount(): number {
    return this.registry.size;
  }

  /** Line-buffer a stream, parsing each complete line into a persisted log. */
  private attachStream(
    runId: string,
    stream: NodeJS.ReadableStream,
    label: "stdout" | "stderr",
    handle: RunHandle,
  ): void {
    const decoder = new StringDecoder("utf8");
    const buffer = new LineBuffer((line) => {
      if (line.trim() === "") return;
      const ev = parseLine(line);
      if (handle.dryRun && label === "stderr") handle.stderrLines.push(ev.message);
      this.handleLine(runId, label, ev);
    });
    const flush = (): void => {
      const tail = decoder.end();
      if (tail) buffer.push(tail);
      buffer.end();
    };
    handle.readers.push({ flush });

    stream.on("data", (chunk: Buffer | string) => {
      buffer.push(typeof chunk === "string" ? chunk : decoder.write(chunk));
    });
    // Flushed on stream end so a trailing partial line is durable before the
    // terminal status is written. Idempotent — safe to call again on 'close'.
    stream.on("end", flush);
    // R6: on a pipe error (EPIPE/EIO), flush the buffer and do NOT let it
    // become an uncaught exception that crashes the supervisor.
    stream.on("error", (err: Error) => {
      console.error(
        `[run-supervisor] ${label} stream error for run ${runId}:`,
        err?.message ?? err,
      );
      try {
        flush();
      } catch (flushErr) {
        console.error(
          `[run-supervisor] failed to flush ${label} after error for run ${runId}:`,
          flushErr,
        );
      }
    });
  }

  /** Persist one parsed line and emit it for the realtime layer. */
  private handleLine(
    runId: string,
    stream: "stdout" | "stderr",
    ev: ParsedLogEvent,
  ): void {
    this.repo.appendLog({
      run_id: runId,
      job: ev.job,
      step: ev.step,
      level: ev.level ?? (stream === "stderr" ? "error" : null),
      message: ev.message,
      ...(ev.ts ? { ts: ev.ts } : {}),
    });
    this.events.emit("log", { runId, line: ev } satisfies LogStreamEvent);
  }

  /**
   * Derive terminal status (cancel-intent-first), persist it, emit, clean up.
   *
   * Called on the process 'close' event (fires after stdio ends), NOT on 'exit'
   * (C2): Node can deliver stdio `data` events after `exit`, so finalizing on
   * `exit` would drop trailing log lines. Buffers are flushed on each stream's
   * `end`/`error` event; this method re-flushes as an idempotent safety net
   * before writing the terminal status (invariant: logs before status).
   *
   * Wrapped in try/catch/finally (R5): a DB failure (e.g. disk-full) in
   * `updateStatus` or `appendLog` is logged but never crashes the supervisor or
   * leaks the handle — `registry.delete` and the status/complete emits always
   * run in `finally`.
   */
  private onClose(runId: string, handle: RunHandle): void {
    if (handle.finalized) return;
    handle.finalized = true;

    // Clear any pending SIGKILL escalation timer (R1) — the process has closed.
    if (handle.killTimer) {
      clearTimeout(handle.killTimer);
      handle.killTimer = undefined;
    }

    let status: RunStatus = "failed";
    try {
      // Flush any streams that haven't ended yet (idempotent if already flushed
      // by the stream 'end'/'error' handler). Ensures every line is durable
      // before the terminal status is written.
      for (const r of handle.readers) r.flush();

      status = handle.cancelRequested
        ? "cancelled"
        : handle.exitCode === 0
          ? "passed"
          : "failed";

      // For a completed dry-run, surface the validity verdict as a summary log.
      if (handle.dryRun && status !== "cancelled") {
        const verdict = interpretValidation(handle.exitCode, handle.stderrLines);
        this.repo.appendLog({
          run_id: runId,
          job: null,
          step: null,
          level: verdict.valid ? "info" : "error",
          message: verdict.valid
            ? "Dry-run: workflow is valid"
            : `Dry-run: workflow is invalid — ${verdict.reason}`,
        });
      }

      // Terminal-once: a cancel arriving after this is a safe no-op.
      this.repo.updateStatus(runId, status);
    } catch (err) {
      // R5: DB errors (e.g. disk-full) must not crash the supervisor or leak
      // the handle. Log and fall through to emit + cleanup in finally.
      console.error(
        `[run-supervisor] failed to finalize run ${runId}:`,
        err,
      );
    } finally {
      // Emit + cleanup always run, even if DB operations threw.
      const evt: StatusEvent = { runId, status };
      this.events.emit("status", evt);
      this.events.emit("complete", evt);
      this.registry.delete(runId);
    }
  }
}
