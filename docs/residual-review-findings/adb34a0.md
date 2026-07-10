# Residual Review Findings — feat/act-web-ui @ adb34a0

Source: Tier 2 code review (`/ce-code-review`, run `20260710-2d962e09`,
artifacts under `/tmp/compound-engineering/ce-code-review/20260710-2d962e09/`).

The critical/high findings were fixed in `5e35fad` (cross-origin WS bypass,
supervisor crash/leak paths, status races, params loss) and bounded cleanups in
`adb34a0` (graceful shutdown, dedupes, type tightening). The following were
**deferred by explicit decision** ("apply bounded fixes now"); they are recorded
here so they are not lost.

## Reliability (deferred)

- **R2 — Run watchdog/timeout.** A stalled `act` (hung image pull, a step
  awaiting input) is supervised as `running` indefinitely. Already documented as
  deferred in the plan's Risks. Add a configurable `RUN_TIMEOUT_MS` that
  escalates SIGTERM→SIGKILL and finalizes `failed` + a diagnostic log.
- **R3 — Kill orphaned act/docker on restart.** `reconcileStaleRuns` fixes the
  DB row but cannot kill the detached act process group from a crashed supervisor
  (no pid is persisted). PID-reuse makes naive `kill(-pgid)` unsafe; needs a
  start-time verification. Lower priority — the in-process SIGKILL-on-cancel
  (R1) and the boot reconciliation cover the common cases.

## Maintainability (deferred)

- **M1 — Extract a `useAsyncFetch` hook.** The `refreshKey` + `active`-flag
  async-fetch effect is hand-rolled in `app/page.tsx`, `app/runs/page.tsx`, and
  (partially) `lib/realtime/use-run-stream.ts`, and has already drifted
  (error-clearing differs). Bigger refactor; defer.
- **M7 — Native `<select>` vs shadcn `Select`.** `run-trigger-panel.tsx` uses
  native `<select>` (for jsdom test ergonomics) while `components/ui/select.tsx`
  was generated but is unused. UX/consistency choice — swap to shadcn, or drop
  the unused generated component.

## Testing gaps (deferred)

- **R23 automated E2E.** The acceptance examples (AE1–AE12) are covered by
  unit/component tests with injected fakes; the real-`act` integration was
  validated by a scripted one-off smoke test, not an automated harness in the
  suite. Decision pending: add a Playwright/real-`act` E2E layer, or accept
  unit + component + the manual smoke test.
- **Full supervisor↔repo↔socket integration test.** Route tests mock the
  supervisor entirely; the three layers are tested in pairwise isolation but not
  wired together through the API in one test.
- Partial error-branch coverage: `POST /api/runs` invalid-JSON→400 and
  generic-500; `rerun` PreFlight→503 / InvalidInvocation→400 / 500 catch-all.
- No test runs real `act` (parseLine/interpretValidation/buildInvocation are
  pinned to synthetic fixtures; an act version bump could shift the `--json`
  schema unnoticed).
