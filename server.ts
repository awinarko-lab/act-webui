import { createServer } from "node:http";
import next from "next";

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

  // SEAMS (wired by their own units; reserved here so U1 does not depend on them):
  //   - U2: after the database initializes, run stale-run reconciliation.
  //   - U6: attach the Socket.io server to `httpServer`, restricted to the
  //         dashboard origin, with per-run rooms.

  httpServer.listen(port, host, () => {
    console.log(`> Act Web UI ready on http://${host}:${port} (dev=${dev})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
