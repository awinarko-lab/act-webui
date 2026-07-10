export type RunStatus = "running" | "passed" | "failed" | "cancelled";

/** A status that marks a run complete; written at most once per run. */
export const TERMINAL_STATUSES: RunStatus[] = ["passed", "failed", "cancelled"];

/** Set form of {@link TERMINAL_STATUSES} for O(1) membership checks. */
export const TERMINAL_STATUS_SET: ReadonlySet<RunStatus> = new Set(
  TERMINAL_STATUSES,
);

export interface NewRun {
  /** Workflow file path or identifier, e.g. ".github/workflows/ci.yml". */
  workflow: string;
  /** Job id when the run is scoped to a single job, else null. */
  job: string | null;
  /** Event context, e.g. "push". */
  event: string;
  /** The trigger parameters, serialized to JSON. */
  params: Record<string, unknown> | null;
}

export interface RunRecord extends NewRun {
  id: string;
  status: RunStatus;
  /** ISO 8601 timestamps. */
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

export interface RunLogLine {
  run_id: string;
  /** Monotonic per-run sequence number; orders the log. */
  seq: number;
  job: string | null;
  step: string | null;
  level: string | null;
  message: string;
  ts: string;
}

export interface RunWithLogs {
  run: RunRecord;
  logs: RunLogLine[];
}
