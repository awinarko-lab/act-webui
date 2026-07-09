import { randomUUID } from "node:crypto";
import type { DB } from "./index";
import {
  TERMINAL_STATUSES,
  type NewRun,
  type RunLogLine,
  type RunRecord,
  type RunStatus,
  type RunWithLogs,
} from "./types";

const HISTORY_LIMIT_DEFAULT = 50;

export function historyLimit(): number {
  const n = Number(process.env.HISTORY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : HISTORY_LIMIT_DEFAULT;
}

export interface AppendLogInput {
  run_id: string;
  job: string | null;
  step: string | null;
  level: string | null;
  message: string;
  ts?: string;
}

export class RunsRepo {
  constructor(private db: DB) {}

  insertRun(input: NewRun): RunRecord {
    const run: RunRecord = {
      id: randomUUID(),
      workflow: input.workflow,
      job: input.job ?? null,
      event: input.event,
      params: input.params ?? null,
      status: "running",
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_ms: null,
    };
    this.db
      .prepare(
        `INSERT INTO runs
           (id, workflow, job, event, status, started_at, ended_at, duration_ms, params)
         VALUES (@id, @workflow, @job, @event, @status, @started_at, @ended_at, @duration_ms, @params)`,
      )
      .run(run);
    return run;
  }

  /** Append a log line; the per-run sequence number is assigned automatically
   * so callers never need to track it. Synchronous (better-sqlite3) so the line
   * is durable before the terminal status is ever written. */
  appendLog(input: AppendLogInput): void {
    const seq = this.nextSeq(input.run_id);
    this.db
      .prepare(
        `INSERT INTO run_logs (run_id, seq, job, step, level, message, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.run_id,
        seq,
        input.job,
        input.step,
        input.level,
        input.message,
        input.ts ?? new Date().toISOString(),
      );
  }

  listRuns(limit = 100): RunRecord[] {
    return this.db
      .prepare(`SELECT * FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ?`)
      .all(limit) as RunRecord[];
  }

  getRun(id: string): RunRecord | undefined {
    return this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as
      | RunRecord
      | undefined;
  }

  getRunWithLogs(id: string): RunWithLogs | undefined {
    const run = this.getRun(id);
    if (!run) return undefined;
    const logs = this.db
      .prepare(`SELECT * FROM run_logs WHERE run_id = ? ORDER BY seq ASC`)
      .all(id) as RunLogLine[];
    return { run, logs };
  }

  /** Transition a run to a terminal status, exactly once. Returns false (no-op)
   * if the run is already terminal — so a cancel arriving after natural exit,
   * or an exit arriving after cancel, cannot flip an already-set status. */
  updateStatus(id: string, status: RunStatus): boolean {
    if (!TERMINAL_STATUSES.includes(status)) {
      throw new Error(`updateStatus requires a terminal status, got: ${status}`);
    }
    const run = this.getRun(id);
    if (!run || run.status !== "running") return false;
    const ended_at = new Date().toISOString();
    const duration_ms = Date.parse(ended_at) - Date.parse(run.started_at);
    const res = this.db
      .prepare(
        `UPDATE runs SET status = ?, ended_at = ?, duration_ms = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(status, ended_at, duration_ms, id);
    return res.changes > 0;
  }

  /** On boot, mark any runs left `running` from a crashed process as `failed`
   * and append a diagnostic log line. Avoids a fifth status value. Returns the
   * number of runs reconciled. */
  reconcileStaleRuns(): number {
    const stale = this.db
      .prepare(`SELECT id FROM runs WHERE status = 'running'`)
      .all() as { id: string }[];
    let count = 0;
    for (const { id } of stale) {
      if (this.updateStatus(id, "failed")) {
        this.appendLog({
          run_id: id,
          job: null,
          step: null,
          level: "error",
          message: "run interrupted: server restarted before act exited",
        });
        count++;
      }
    }
    return count;
  }

  /** Keep the `limit` most recent runs per repo, pruning older terminal runs.
   * A run still `running` is never pruned (it may be actively appending logs). */
  pruneToLimit(limit: number = historyLimit()): number {
    const res = this.db
      .prepare(
        `DELETE FROM runs
         WHERE id IN (
           SELECT id FROM runs
           WHERE status IN ('passed', 'failed', 'cancelled')
           ORDER BY started_at DESC, rowid DESC
           LIMIT -1 OFFSET ?
         )`,
      )
      .run(limit);
    return res.changes;
  }

  private nextSeq(run_id: string): number {
    const row = this.db
      .prepare(`SELECT MAX(seq) AS m FROM run_logs WHERE run_id = ?`)
      .get(run_id) as { m: number | null };
    return (row.m ?? -1) + 1;
  }
}
