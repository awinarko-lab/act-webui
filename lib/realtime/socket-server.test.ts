import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";
import { io as ioc, type Socket } from "socket.io-client";

import { openDatabase } from "../db/index";
import { RunsRepo } from "../db/runs-repo";
import type { NewRun, RunStatus } from "../db/types";
import type { ParsedLogEvent } from "../runner/types";
import { attachSocketServer } from "./socket-server";
import {
  LOG_EVENT,
  RUN_COMPLETE,
  RUN_STATUS,
  SUBSCRIBE,
  type LogEventPayload,
  type RunStatusPayload,
} from "./events";

/**
 * U6 socket server tests (node env, no jsdom). Drives a real http.Server +
 * attached Socket.io server against an in-memory SQLite repo and a fake
 * supervisor (a plain EventEmitter), connecting a real socket.io-client from
 * within the test. No real `act` is ever spawned.
 *
 * Reusable infra pattern for U7/U8: the `subscribe`/`nextN` helpers and the
 * listen/close lifecycle are the shape later UI integration tests can adopt.
 */

function makeRepo(): RunsRepo {
  return new RunsRepo(openDatabase(":memory:"));
}

function listen(server: HttpServer): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function close(server: HttpServer): Promise<void> {
  return new Promise((res, rej) => server.close((e) => (e ? rej(e) : res())));
}

/**
 * Connect a client, subscribe to a run, and resolve once the server's replay
 * confirms the join (the `run:status` replayed on subscribe). Requires the run
 * to already exist so the replay emits a status.
 */
async function subscribe(client: Socket, runId: string): Promise<void> {
  await new Promise<void>((res) => {
    if (client.connected) res();
    else client.once("connect", () => res());
  });
  await new Promise<void>((res) => {
    client.once(RUN_STATUS, () => res());
    client.emit(SUBSCRIBE, { runId });
  });
}

/** Collect the next `count` payloads for an event, then unsubscribe. */
function nextN<T = unknown>(
  client: Socket,
  event: string,
  count: number,
): Promise<T[]> {
  return new Promise((resolve) => {
    const collected: T[] = [];
    const handler = (payload: T): void => {
      collected.push(payload);
      if (collected.length >= count) {
        client.off(event, handler);
        resolve(collected);
      }
    };
    client.on(event, handler);
  });
}

interface SeedOpts {
  status?: RunStatus;
  logs?: string[];
}

describe("attachSocketServer", () => {
  let httpServer: HttpServer;
  let repo: RunsRepo;
  let supervisorEvents: EventEmitter;
  let clients: Socket[];
  let origin: string;
  let savedAllowedOrigin: string | undefined;

  beforeEach(async () => {
    repo = makeRepo();
    supervisorEvents = new EventEmitter();
    httpServer = createServer();
    origin = await listen(httpServer);
    // Pin the allowed origin to the ephemeral server so the CORS allow-list
    // matches the test client (KTD9 path).
    savedAllowedOrigin = process.env.ALLOWED_ORIGIN;
    process.env.ALLOWED_ORIGIN = origin;
    attachSocketServer(httpServer, {
      supervisor: { events: supervisorEvents },
      repo,
    });
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    await close(httpServer);
    if (savedAllowedOrigin === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = savedAllowedOrigin;
  });

  function connect(): Socket {
    const c = ioc(origin, { transports: ["websocket"] });
    clients.push(c);
    return c;
  }

  function seedRun(opts: SeedOpts = {}): string {
    const newRun: NewRun = {
      workflow: ".github/workflows/ci.yml",
      job: null,
      event: "push",
      params: null,
    };
    const run = repo.insertRun(newRun);
    for (const msg of opts.logs ?? []) {
      repo.appendLog({
        run_id: run.id,
        job: "build",
        step: "build",
        level: "info",
        message: msg,
      });
    }
    const status: RunStatus = opts.status ?? "running";
    if (status !== "running") repo.updateStatus(run.id, status);
    return run.id;
  }

  function line(message: string, extra: Partial<ParsedLogEvent> = {}): ParsedLogEvent {
    return {
      raw: false,
      message,
      level: "info",
      job: "build",
      step: "build",
      ...extra,
    };
  }

  it("delivers a live log:event to a subscribed client", async () => {
    const runId = seedRun();
    const client = connect();
    await subscribe(client, runId);

    const logPromise = nextN<LogEventPayload>(client, LOG_EVENT, 1);
    supervisorEvents.emit("log", { runId, line: line("hello world") });

    const [payload] = await logPromise;
    expect(payload.runId).toBe(runId);
    expect(payload.message).toBe("hello world");
    expect(payload.job).toBe("build");
  });

  it("broadcasts run:status when the supervisor emits status", async () => {
    const runId = seedRun();
    const client = connect();
    await subscribe(client, runId);

    const statusPromise = nextN<RunStatusPayload>(client, RUN_STATUS, 1);
    supervisorEvents.emit("status", { runId, status: "failed" });

    const [payload] = await statusPromise;
    expect(payload.runId).toBe(runId);
    expect(payload.status).toBe("failed");
  });

  it("emits run:complete (and run:status) on supervisor complete", async () => {
    const runId = seedRun();
    const client = connect();
    await subscribe(client, runId);

    const statusPromise = nextN<RunStatusPayload>(client, RUN_STATUS, 1);
    const completePromise = nextN<RunStatusPayload>(client, RUN_COMPLETE, 1);
    supervisorEvents.emit("complete", { runId, status: "passed" });

    const [status] = await statusPromise;
    const [complete] = await completePromise;
    expect(status.status).toBe("passed");
    expect(complete.status).toBe("passed");
  });

  it("replays persisted logs in seq order then current status on subscribe (AE8 mid-run reconnect)", async () => {
    const runId = seedRun({
      status: "running",
      logs: ["line one", "line two", "line three"],
    });

    const client = connect();
    const logsPromise = nextN<LogEventPayload & { seq?: number }>(
      client,
      LOG_EVENT,
      3,
    );
    await subscribe(client, runId);

    const logs = await logsPromise;
    expect(logs.map((l) => l.message)).toEqual([
      "line one",
      "line two",
      "line three",
    ]);
    expect(logs.map((l) => l.seq)).toEqual([0, 1, 2]);

    // After replay, a newly emitted live line arrives with no loss.
    const livePromise = nextN<LogEventPayload>(client, LOG_EVENT, 1);
    supervisorEvents.emit("log", { runId, line: line("live four") });
    const [live] = await livePromise;
    expect(live.message).toBe("live four");
  });

  it("replays terminal status + run:complete for an already-completed run (reconnect-to-completed)", async () => {
    const runId = seedRun({ status: "passed", logs: ["done line"] });

    const client = connect();
    const logsPromise = nextN<LogEventPayload>(client, LOG_EVENT, 1);
    const completePromise = nextN<RunStatusPayload>(client, RUN_COMPLETE, 1);
    // subscribe resolves on the replayed run:status (the first one).
    await subscribe(client, runId);

    const [log] = await logsPromise;
    expect(log.message).toBe("done line");

    const [complete] = await completePromise;
    expect(complete.status).toBe("passed");
  });

  it("does not deliver another run's events to an unrelated room", async () => {
    const runA = seedRun();
    const runB = seedRun();
    const client = connect();
    await subscribe(client, runA);

    let received = false;
    client.on(LOG_EVENT, () => {
      received = true;
    });
    supervisorEvents.emit("log", { runId: runB, line: line("B only") });

    // Give the event a tick to (not) arrive.
    await new Promise((res) => setTimeout(res, 30));
    expect(received).toBe(false);
  });

  it("registers supervisor listeners once across repeated attaches", async () => {
    // A second attach against the same supervisor EventEmitter must not duplicate
    // delivery (the WeakSet guard in socket-server prevents double-registration).
    attachSocketServer(createServer(), {
      supervisor: { events: supervisorEvents },
      repo,
    });

    const runId = seedRun();
    const client = connect();
    await subscribe(client, runId);

    const logPromise = nextN<LogEventPayload>(client, LOG_EVENT, 1);
    supervisorEvents.emit("log", { runId, line: line("once") });
    const logs = await logPromise;
    expect(logs).toHaveLength(1);
  });
});
