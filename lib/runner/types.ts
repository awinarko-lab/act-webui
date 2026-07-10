import type { RunStatus } from "../db/types";

/**
 * A parsed act log line. The {@link raw} flag distinguishes structured events
 * (valid JSON) from lines that were passed through verbatim (act's non-JSON
 * output, e.g. `--validate` diagnostics).
 */
export interface ParsedLogEvent {
  /** True when the line was not valid JSON and is passed through verbatim. */
  raw: boolean;
  message: string;
  level: string | null;
  job: string | null;
  step: string | null;
  /** ISO timestamp extracted from the line, when present. */
  ts?: string;
}

/** A request to start (and supervise) an act run. */
export interface RunRequest {
  /** Workflow file path, e.g. ".github/workflows/ci.yml". */
  workflow: string;
  /** Optional single-job id (passed as `-j`). */
  job?: string | null;
  /** Event context (act's positional argument). Defaults to "push". */
  event?: string;
  /** Dry-run: invoke `act --validate` (no container). */
  dryRun?: boolean;
  /** Opaque trigger parameters, persisted with the run. */
  params?: Record<string, unknown> | null;
}

/**
 * The process surface the supervisor depends on. A real `child_process` ChildProcess
 * (wrapped) and the test fake both satisfy this; the supervisor only ever uses
 * the members listed here.
 */
export interface SupervisedProcess {
  readonly pid: number;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  /** Listens for process termination: code is null when killed by a signal. */
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  /** Fires after the process has exited AND its stdio streams have closed —
   * the safe point to finalize (all trailing log data has been delivered). */
  on(event: "close", listener: () => void): this;
  /** Kill the process (in production, the whole process group). */
  kill(signal?: NodeJS.Signals): boolean;
}

export interface SpawnOptions {
  /** Directory act runs in (the repo root). */
  cwd: string;
}

/**
 * Injectable process factory. The default wraps `child_process.spawn` with a
 * detached process group so cancel kills the whole tree. Tests inject a fake
 * that returns a controllable process — no Docker required.
 */
export type Spawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => SupervisedProcess;

/** Result of a dry-run (`act --validate`) evaluation. */
export interface ValidationResult {
  valid: boolean;
  /** Human-readable reason on failure (e.g. the first validation error). */
  reason?: string;
  /** Exit code of `act --validate`, for diagnostics. */
  exitCode: number | null;
}

/** Terminal status event emitted on the supervisor's {@link RunSupervisor.events}. */
export interface StatusEvent {
  runId: string;
  status: RunStatus;
}

/** A structured log event emitted on the supervisor's {@link RunSupervisor.events}. */
export interface LogStreamEvent {
  runId: string;
  line: ParsedLogEvent;
}

/**
 * Thrown when a workflow/job/event identifier fails sanitization (KTD9), before
 * act is ever invoked. Carries the offending field for a clear API response.
 */
export class InvalidInvocationError extends Error {
  readonly field: "workflow" | "job" | "event";
  constructor(field: "workflow" | "job" | "event", message: string) {
    super(message);
    this.name = "InvalidInvocationError";
    this.field = field;
    // Restore the prototype chain (target is ES2017) so `instanceof` works.
    Object.setPrototypeOf(this, InvalidInvocationError.prototype);
  }
}

/**
 * Thrown when a pre-flight check (act or container availability) fails, before
 * any run row is persisted. Lets the API return a diagnostic without leaving a
 * `running` row in history.
 */
export class PreFlightError extends Error {
  readonly details: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "PreFlightError";
    this.details = details;
    Object.setPrototypeOf(this, PreFlightError.prototype);
  }
}
