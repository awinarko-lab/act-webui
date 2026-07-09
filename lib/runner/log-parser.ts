import type { ParsedLogEvent } from "./types";

/**
 * Parse one stdout/stderr line emitted by `act --json`.
 *
 * act's `--json` schema is not formally stable, so this is deliberately
 * tolerant: it pulls whatever fields it recognizes and never throws. A line that
 * is not valid JSON (e.g. act's non-JSON `--validate` diagnostics, or a stray
 * progress line) becomes a raw passthrough event carrying the whole line as its
 * message.
 *
 * Observed act 0.2.89 shape (verified): `msg`, `level`, `job` (display name like
 * "workflow/jobID"), `jobID` (the real job id, matches `-j`), `step`, `stage`,
 * `time` (ISO 8601), `raw_output`, `stepResult`, `jobResult`. `jobID` is
 * preferred for the job label because it matches the `-j` argument.
 */
export function parseLine(line: string): ParsedLogEvent {
  const text = line.replace(/\r$/, "").trim();
  if (text === "") {
    return { raw: true, message: "", level: null, job: null, step: null };
  }

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { raw: true, message: text, level: null, job: null, step: null };
  }

  // A bare primitive (number/string) or array is JSON but not a log object.
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { raw: true, message: text, level: null, job: null, step: null };
  }

  const record = obj as Record<string, unknown>;
  const message = str(record.msg) ?? str(record.message) ?? text;
  const level = str(record.level) ?? null;
  const job =
    str(record.jobID) ??
    str(record.job_id) ??
    str(record.jobId) ??
    str(record.jobName) ??
    str(record.job) ??
    null;
  const step = str(record.step) ?? null;
  const ts = str(record.time) ?? str(record.timestamp);

  return { raw: false, message, level, job, step, ts };
}

/** Non-empty string guard used to short-circuit missing/blank fields. */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Accumulates arbitrary string chunks until a newline and emits complete lines.
 * The trailing partial line (no terminating newline) is flushed by {@link end}.
 *
 * This is what makes a JSON object split across two `data` chunks parse into a
 * single structured event rather than being demoted to two raw passthroughs: the
 * two halves are reassembled into one line before the parser ever sees them.
 *
 * CRLF is normalized to LF (a trailing `\r` is stripped from each emitted line).
 */
export class LineBuffer {
  private pending = "";
  private ended = false;
  private readonly onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  /** Append a chunk and emit each complete (`\n`-terminated) line. */
  push(chunk: string): void {
    if (this.ended) return;
    this.pending += chunk;
    let idx: number;
    while ((idx = this.pending.indexOf("\n")) >= 0) {
      let line = this.pending.slice(0, idx);
      this.pending = this.pending.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.onLine(line);
    }
  }

  /** Flush any trailing partial line. Idempotent — safe to call from both the
   * stream `end` handler and the process `exit` handler. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.pending.length > 0) {
      let line = this.pending;
      this.pending = "";
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.onLine(line);
    }
  }
}
