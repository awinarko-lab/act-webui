import "./lib/polyfills/async-local-storage";
import { createServer } from "node:http";
import next from "next";
import { getDb } from "./lib/db";
import { RunsRepo } from "./lib/db/runs-repo";
import { attachSocketServer } from "./lib/realtime/socket-server";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
// Local-first: bind to loopback by default. A non-loopback host is an explicit
// opt-in gated on auth (plan KTD9). Node's http.listen(port) defaults to 0.0.0.0,
// which would expose the unauthenticated run API to the LAN.
const host = process.env.HOST ?? "127.0.0.1";

async function main() {
  const app = next({ dev });
  const handle = app.getRequestHandler();
  await app.prepare();

  // One HTTP server hosts both Next (App Router + /api) and, later, Socket.io.
  const httpServer = createServer((req, res) => handle(req, res));

  // Persistence (U2): open the database, reconcile runs orphaned in `running`
  // by a previous crash, and prune to the keep-last-N limit.
  const db = getDb();
  const runs = new RunsRepo(db);
  const reconciled = runs.reconcileStaleRuns();
  const pruned = runs.pruneToLimit();
  if (reconciled || pruned) {
    console.log(`> db: reconciled ${reconciled} stale run(s), pruned ${pruned} run(s)`);
  }

  // U6: attach the Socket.io server to the same HTTP server, restricted to the
  // dashboard origin, with per-run rooms and reconnect-safe replay.
  const io = attachSocketServer(httpServer);

  httpServer.listen(port, host, () => {
    console.log(`> Act Web UI ready on http://${host}:${port} (dev=${dev})`);
  });

  // R4: graceful shutdown. Close the socket server first (stops accepting new
  // connections), then the HTTP server, then the database. A flag guards a
  // double-signal (SIGINT then SIGTERM, or vice versa) so the handlers are
  // idempotent. The supervisor's in-flight runs are detached and reconciled on
  // next boot — that is the documented recovery path.
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("> shutting down...");
    io.close();
    httpServer.close();
    getDb().close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
