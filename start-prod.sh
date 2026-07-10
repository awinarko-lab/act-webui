#!/usr/bin/env bash
# ── Act Web UI — production launcher (behind a Cloudflare Tunnel) ──────────────
#
#   ./start-prod.sh            # build (if stale) + start
#   BUILD=0 ./start-prod.sh    # start only, skip the build step
#   PORT=3100 ./start-prod.sh  # override port (also used by cloudflared)
#
# Prerequisites:
#   - ALLOWED_ORIGIN set in .env to your tunnel URL (e.g. https://act.real.dev)
#   - cloudflared configured to proxy to http://127.0.0.1:$PORT
#   - Cloudflare Access (Zero Trust) gating the hostname — the run API is
#     unauthenticated and runs arbitrary workflow code via act; NEVER expose it
#     publicly without auth in front.
set -euo pipefail

# Resolve the repo root so the script works from any cwd.
cd "$(dirname "$0")"

PORT="${PORT:-3000}"

# Fail fast if ALLOWED_ORIGIN is still the placeholder or missing.
ALLOWED_ORIGIN="$(node -e "try{console.log(require('fs').readFileSync('.env','utf8').split('\n').filter(l=>l.startsWith('ALLOWED_ORIGIN=')).map(l=>l.split('=')[1])[0]||'')}catch(e){console.log('')}")"
case "${ALLOWED_ORIGIN:-}" in
  ""|"https://act.example.com")
    echo "⚠️  Set ALLOWED_ORIGIN in .env to your real tunnel URL" >&2
    echo "    (currently: '${ALLOWED_ORIGIN:-<empty>}')" >&2
    exit 1
    ;;
esac

# Build the Next.js production bundle (skip with BUILD=0 once built).
if [ "${BUILD:-1}" = "1" ]; then
  echo "▶ building (skip with BUILD=0)…"
  npm run build
fi

# Host/port must live in the shell env: server.ts reads them before Next loads
# .env. ALLOWED_ORIGIN/NODE_ENV come from .env (read at request time).
echo "▶ starting on 127.0.0.1:${PORT}  (tunnel origin: ${ALLOWED_ORIGIN})"
exec env "HOST=127.0.0.1" "PORT=${PORT}" NODE_ENV=production npm start
