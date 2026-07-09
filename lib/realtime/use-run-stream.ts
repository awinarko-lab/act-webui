"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

import type { RunLogLine, RunRecord, RunStatus } from "../db/types";
import { LOG_EVENT, RUN_COMPLETE, RUN_STATUS, SUBSCRIBE } from "./events";
import type { LogEventPayload, RunStatusPayload } from "./events";

export interface RunStreamState {
  run: RunRecord | null;
  logs: RunLogLine[];
  status: RunStatus | null;
}

/**
 * Subscribe to a run's live log + status stream.
 *
 * Seeds from `GET /api/runs/[id]` so the UI renders something immediately even
 * before the socket catches up, then opens a Socket.io connection, joins the
 * run's room, and appends live `log:event`s and status transitions. The seed is
 * merged (not overwritten) with whatever the socket already replayed, and live
 * events dedup by `seq`, so a fast reconnect replay can neither duplicate nor
 * lose a persisted line.
 *
 * Pass `null` to get an empty state with no connection (used while no run is
 * selected).
 */
export function useRunStream(runId: string | null): RunStreamState {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [logs, setLogs] = useState<RunLogLine[]>([]);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [prevRunId, setPrevRunId] = useState<string | null>(runId);

  // Reset all accumulated state when the watched run changes (including to
  // null). Adjusting state during render — rather than calling setState
  // synchronously inside the connect effect — avoids cascading renders (see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  if (runId !== prevRunId) {
    setPrevRunId(runId);
    setRun(null);
    setLogs([]);
    setStatus(null);
  }

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;
    const origin = window.location.origin;
    const socket: Socket = io(origin);

    socket.emit(SUBSCRIBE, { runId });

    socket.on(LOG_EVENT, (payload: LogEventPayload) => {
      if (payload.runId !== runId) return;
      setLogs((prev) => appendLiveLog(prev, payload));
    });

    const applyStatus = (payload: RunStatusPayload): void => {
      if (payload.runId !== runId) return;
      setStatus(payload.status);
      setRun((prev) => (prev ? { ...prev, status: payload.status } : prev));
    };
    socket.on(RUN_STATUS, applyStatus);
    socket.on(RUN_COMPLETE, applyStatus);

    fetch(`${origin}/api/runs/${runId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { run?: RunRecord; logs?: RunLogLine[] } | null) => {
        if (cancelled || !data) return;
        if (data.run) {
          setRun(data.run);
          setStatus(data.run.status);
        }
        if (data.logs) {
          const incomingLogs = data.logs;
          setLogs((prev) => mergeLogs(prev, incomingLogs));
        }
      })
      .catch(() => {
        // Seed failure is non-fatal: the socket still streams live events.
      });

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [runId]);

  return { run, logs, status };
}

/** Append a live (socket) log event, deduping against persisted lines by `seq`. */
function appendLiveLog(prev: RunLogLine[], ev: LogEventPayload): RunLogLine[] {
  if (ev.seq != null && prev.some((l) => l.seq === ev.seq)) {
    return prev;
  }
  const fallbackSeq =
    prev.length > 0 ? (prev[prev.length - 1].seq ?? -1) + 1 : 0;
  return [
    ...prev,
    {
      run_id: ev.runId,
      seq: ev.seq ?? fallbackSeq,
      job: ev.job,
      step: ev.step,
      level: ev.level,
      message: ev.message,
      ts: ev.ts,
    },
  ];
}

/**
 * Reconcile two log buffers: persisted lines (with `seq`) are deduped by seq and
 * ordered; live (seq-less) lines follow in arrival order. Used to merge the HTTP
 * seed with socket-replayed lines without loss or duplication.
 */
function mergeLogs(existing: RunLogLine[], incoming: RunLogLine[]): RunLogLine[] {
  const bySeq = new Map<number, RunLogLine>();
  const live: RunLogLine[] = [];
  const add = (l: RunLogLine): void => {
    if (l.seq != null) bySeq.set(l.seq, l);
    else live.push(l);
  };
  for (const l of existing) add(l);
  for (const l of incoming) add(l);
  const sorted = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  return [...sorted, ...live];
}
