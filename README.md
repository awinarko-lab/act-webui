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

## Scripts

- `npm run dev` — custom server with Hot Module Replacement
- `npm run build` — production build
- `npm start` — run the production custom server (set `NODE_ENV=production`)
- `npm test` — run the Vitest suite
- `npm run lint` — ESLint
