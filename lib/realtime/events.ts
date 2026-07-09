import type { RunStatus } from "../db/types";

/**
 * Socket.io event names shared by the server (`socket-server`) and the browser
 * client (`use-run-stream`). Defined once here so the two ends can never drift
 * on a string typo.
 */

/** Client → server: join a run's room to receive replay + live events. */
export const SUBSCRIBE = "subscribe";

/** Server → client: one structured act log line. */
export const LOG_EVENT = "log:event";

/** Server → client: a status transition (live) or current persisted status
 * (replayed on subscribe). */
export const RUN_STATUS = "run:status";

/** Server → client: the run reached a terminal status. Emitted once on the
 * supervisor's `complete` event, and additionally on subscribe-replay when the
 * run is already terminal. */
export const RUN_COMPLETE = "run:complete";

/** Payload for {@link SUBSCRIBE}. */
export interface SubscribePayload {
  runId: string;
}

/**
 * Payload for {@link LOG_EVENT}.
 *
 * On **replay** (subscribe), every field comes from a persisted `RunLogLine`, so
 * `seq` is present and the line is authoritative. On the **live** path the
 * supervisor emits a parsed line before its seq is known to this layer, so `seq`
 * is omitted; clients that reconcile replay against an HTTP seed dedup by `seq`.
 */
export interface LogEventPayload {
  runId: string;
  /** Monotonic per-run sequence number; present on replayed lines, omitted on
   * live supervisor events. */
  seq?: number;
  job: string | null;
  step: string | null;
  level: string | null;
  message: string;
  ts: string;
  /** True when the source line was not valid JSON and is passed through verbatim
   * (e.g. `act --validate` diagnostics). Only set on the live path. */
  raw?: boolean;
}

/** Payload for {@link RUN_STATUS} and {@link RUN_COMPLETE}. */
export interface RunStatusPayload {
  runId: string;
  status: RunStatus;
}
