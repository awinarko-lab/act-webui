# Act Web UI

A local-first web dashboard that wraps the [`act`](https://github.com/nektos/act)
CLI so you can run GitHub Actions workflows locally with a GUI: discover
workflows, trigger whole-workflow / single-job / event-simulated runs, watch
live per-job step logs, and keep full-log run history.

## Requirements

- Node 20+ (developed on Node 21; an LTS or current ≥ 20 works)
- `act` on `PATH` (tested with 0.2.89) — with `--json`, `-j`, `--validate`, `-e`
- Docker or Podman (act executes workflows in containers)

## Getting started

```bash
npm install
npm run dev        # custom server on http://127.0.0.1:3000
```

The server binds to loopback by default (`HOST=127.0.0.1`). See `.env.example`
for configuration (port, repo path, SQLite location, history limit).

### Binding to all interfaces (0.0.0.0)

To access the dashboard from other devices on your network (e.g., Tailscale,
LAN), set `HOST=0.0.0.0`:

```bash
HOST=0.0.0.0 PORT=3030 npm run dev
```

When bound to `0.0.0.0`, the origin guard accepts requests from any IP with
the correct port, allowing browser access from any network interface.

> **Note:** In development mode, Next.js HMR (Hot Module Replacement) WebSocket
> connections only work reliably from `localhost`. For remote access, consider
> building for production: `HOST=0.0.0.0 PORT=3030 npm run build && npm start`

## Scripts

- `npm run dev` — custom server with Hot Module Replacement
- `npm run build` — production build
- `npm start` — run the production custom server (set `NODE_ENV=production`)
- `npm test` — run the Vitest suite
- `npm run lint` — ESLint

## Example workflows

The repository includes example GitHub Actions workflows in `.github/workflows/`:
- `ci.yml` — Simple CI workflow with greeting and lint jobs
- `test.yml` — Comprehensive test workflow with setup, build, lint, integration tests, and deployment simulation

These workflows are automatically discovered by the dashboard and can be run directly from the UI.

## Configuration

### Environment variables

- `HOST` — Server bind address (default: `127.0.0.1`, use `0.0.0.0` for all interfaces)
- `PORT` — Server port (default: `3000`)
- `ACT_REPO_PATH` — Path to repository containing workflows (default: current directory)
- `DATABASE_PATH` — SQLite database location (default: `.act-web-ui/db.sqlite`)
- `RUN_HISTORY_LIMIT` — Maximum runs to keep in history (default: `100`)
- `ALLOWED_ORIGIN` — Explicit origin override for locked-down deployments

### Development notes

- TypeScript is enforced (`npx tsc --noEmit`)
- Tests use Vitest with coverage
- The origin guard (KTD9) prevents cross-origin requests to the run API
- SQLite uses WAL mode for better concurrent access
