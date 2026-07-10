import { EventEmitter } from "node:events";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";

import { allowedOrigin, isOriginAllowed } from "../api/origin-guard";
import { type RunWithLogs, TERMINAL_STATUS_SET } from "../db/types";
import type { ParsedLogEvent } from "../runner/types";
import { getRunsRepo, getSupervisor } from "../runtime";
import {
  LOG_EVENT,
  RUN_COMPLETE,
  RUN_STATUS,
  SUBSCRIBE,
} from "./events";
import type {
  LogEventPayload,
  RunStatusPayload,
  SubscribePayload,
} from "./events";

/** Room name for a run's live audience. */
export function roomFor(runId: string): string {
  return `run:${runId}`;
}

/** The supervisor surface this module consumes (the shared singleton by
 * default, but injectable for tests). */
interface SupervisorLike {
  readonly events: EventEmitter;
}

/** Repo surface used for replay (read-only). */
interface RepoLike {
  getRunWithLogs(id: string): RunWithLogs | undefined;
}

export interface AttachSocketServerOptions {
  /** Defaults to the process-wide {@link getSupervisor}. */
  supervisor?: SupervisorLike;
  /** Defaults to {@link getRunsRepo}. */
  repo?: RepoLike;
}

/**
 * Tracks which supervisor `EventEmitter`s already have forwarding listeners
 * attached. Keyed on the EventEmitter instance so:
 *  - repeated `attachSocketServer` calls against the process-wide singleton never
 *    double-register (which would duplicate every emitted event), and
 *  - a test's fresh fake supervisor always attaches cleanly on its first call.
 */
const attachedSupervisors = new WeakSet<EventEmitter>();

/**
 * Attach a Socket.io server to an existing HTTP server, restricted to the
 * dashboard origin so a cross-origin page cannot join a room and read logs
 * (KTD9). Each run has a room keyed by its id.
 *
 * On `subscribe`, the joining socket is replayed the run's persisted logs (in
 * `seq` order) and then a single status event reflecting the run's current
 * persisted status — so a reconnecting client learns the terminal state and full
 * log with no loss (R14/AE8), whether or not the run is still live.
 *
 * Live `log`/`status`/`complete` events from the supervisor are forwarded to the
 * matching run room. The supervisor drops its handle on exit and emits nothing
 * further for that run, so no live `log:event` is ever emitted for a completed
 * run; rooms themselves are ephemeral (Socket.io tears them down when empty), so
 * no hard delete is needed.
 *
 * Returns the Socket.io `Server` (useful for tests).
 */
export function attachSocketServer(
  httpServer: HttpServer,
  options: AttachSocketServerOptions = {},
): Server {
  const supervisor = options.supervisor ?? getSupervisor();
  const repo = options.repo ?? getRunsRepo();

  const io = new Server(httpServer, {
    cors: { origin: allowedOrigin(), methods: ["GET", "POST"] },
    // Hard cross-origin reject at the Engine.io level (S1). The `cors` option
    // only sets Access-Control-Allow-Origin headers for the polling handshake —
    // it does NOT refuse the connection, so a page forcing
    // `transports:["websocket"]` skips that handshake and could otherwise join a
    // room and read replayed/streamed logs (which may contain secrets).
    // `allowRequest` runs for EVERY transport (polling and websocket) before the
    // connection is established, so the bypass is closed regardless of transport.
    // A browser always sends `Origin` on a WebSocket handshake, so a present
    // mismatched Origin is rejected; an absent Origin (non-browser client, or a
    // same-origin request that omitted it) is allowed to proceed.
    allowRequest(req, fn) {
      const origin = req.headers.origin;
      if (origin != null && !isOriginAllowed(origin)) {
        fn("origin not allowed", false);
        return;
      }
      fn(null, true);
    },
  });

  io.on("connection", (socket: Socket) => {
    socket.on(SUBSCRIBE, (payload: SubscribePayload) => {
      const runId = payload?.runId;
      if (!runId) return;
      socket.join(roomFor(runId));
      // Replay is emitted to the joining socket only — other members of the
      // room already have this history, and room-wide broadcast would duplicate.
      replayRun(socket, runId, repo);
    });
  });

  attachSupervisorListeners(io, supervisor);

  return io;
}

/**
 * Emit the run's persisted logs (seq order) then its current status to the
 * joining socket. For an already-terminal run a {@link RUN_COMPLETE} follows, so
 * a reconnect-to-completed client learns the terminal state. Ordering is
 * guaranteed: `getRunWithLogs` returns logs `ORDER BY seq ASC`, and Socket.io
 * preserves emit order on a single socket.
 */
function replayRun(socket: Socket, runId: string, repo: RepoLike): void {
  const result = repo.getRunWithLogs(runId);
  if (!result) return;

  for (const line of result.logs) {
    const payload: LogEventPayload = {
      runId,
      seq: line.seq,
      job: line.job,
      step: line.step,
      level: line.level,
      message: line.message,
      ts: line.ts,
    };
    socket.emit(LOG_EVENT, payload);
  }

  const statusPayload: RunStatusPayload = {
    runId,
    status: result.run.status,
  };
  socket.emit(RUN_STATUS, statusPayload);
  if (TERMINAL_STATUS_SET.has(result.run.status)) {
    socket.emit(RUN_COMPLETE, statusPayload);
  }
}

/**
 * Forward supervisor events to run rooms. Registered at most once per supervisor
 * EventEmitter (see {@link attachedSupervisors}); idempotent across attaches.
 */
function attachSupervisorListeners(
  io: Server,
  supervisor: SupervisorLike,
): void {
  const events = supervisor.events;
  if (attachedSupervisors.has(events)) return;
  attachedSupervisors.add(events);

  events.on("log", ({ runId, line }: { runId: string; line: ParsedLogEvent }) => {
    const payload: LogEventPayload = {
      runId,
      job: line.job,
      step: line.step,
      level: line.level,
      message: line.message,
      ts: line.ts ?? new Date().toISOString(),
      ...(line.raw ? { raw: true } : {}),
    };
    io.to(roomFor(runId)).emit(LOG_EVENT, payload);
  });

  events.on("status", (evt: RunStatusPayload) => {
    io.to(roomFor(evt.runId)).emit(RUN_STATUS, evt);
  });

  events.on("complete", (evt: RunStatusPayload) => {
    io.to(roomFor(evt.runId)).emit(RUN_STATUS, evt);
    io.to(roomFor(evt.runId)).emit(RUN_COMPLETE, evt);
  });
}
