---
module: "server runtime bootstrap (Next.js 16 App Router custom ESM server under tsx)"
date: 2026-07-10
problem_type: runtime_error
component: tooling
severity: critical
category: runtime-errors
symptoms:
  - "App crashes at boot with Error: Invariant: AsyncLocalStorage accessed in runtime where it is not available"
  - "Next.js error code E504 thrown at render time"
  - "Failure only reproduces when running via custom ESM server under tsx, not via next dev / next start"
root_cause: incomplete_setup
resolution_type: code_fix
tags:
  - nextjs
  - async-local-storage
  - tsx
  - polyfill
  - custom-server
  - app-router
---

# Custom server crashes at boot with `AsyncLocalStorage` not available (Next.js 16 App Router under `tsx`)

## Problem

Running the Next.js 16 App Router through a custom ESM server (`server.ts` launched with `tsx watch server.ts`) crashed the dev server at boot with `Error: Invariant: AsyncLocalStorage accessed in runtime where it is not available` (Next error code `E504`). The process exited before it could answer any request, so the local-first dashboard and its `/api` endpoints were completely unreachable.

## Symptoms

- Dev server crashes immediately on startup; the process never reaches `httpServer.listen`, so nothing is served.
- Fatal error thrown from Next internals:
  `Error: Invariant: AsyncLocalStorage accessed in runtime where it is not available` (Next error code `E504`).
- Stack trace originates in `node_modules/next/dist/server/app-render/async-local-storage.js`, hit during the first App Router render.
- The crash only surfaced once a dynamic client page was added. Earlier, the create-next-app default home page appeared to work because it was statically prerendered and never exercised the async store.

## What Didn't Work

- **Assuming Next 16 removed the custom-server API.** A custom server constructed via `const app = next({ dev })` / `app.getRequestHandler()` is still supported in Next 16. Confirming with `node --input-type=module -e "import next from 'next'"` showed the default import is a function and `getRequestHandler` is present, so this was a dead end — the crash is unrelated to custom-server support.
- **Treating it as "it used to work."** The create-next-app default home page is statically prerendered and never touches the App Router async store, so it masked the problem. Adding any dynamic client page triggered the first real render and exposed the failure. The regression was latent, not newly introduced.
- **Looking for `globalThis.AsyncLocalStorage` as a built-in.** Node does not expose `AsyncLocalStorage` as a global; it lives only in `node:async_hooks`. Without something setting the global, Next keeps falling back to the throwing implementation.

## Solution

Next's `async-local-storage.js` gates on a global:

```js
const maybeGlobalAsyncLocalStorage =
  typeof globalThis !== "undefined" && globalThis.AsyncLocalStorage;
```

When that global is absent, Next instantiates a `FakeAsyncLocalStorage` whose `run()` and `enterWith()` throw the E504 invariant. `next dev` / `next start` set the global themselves; a custom server under `tsx` does not. So we polyfill it from `node:async_hooks` before Next is imported.

`lib/polyfills/async-local-storage.ts`:

```ts
// Next.js reads `globalThis.AsyncLocalStorage` to back its App Router async
// storage; when it's absent Next falls back to a Fake implementation that throws
// at render time ("Invariant: AsyncLocalStorage accessed in runtime where it is
// not available"). Node exposes AsyncLocalStorage via `node:async_hooks`, not as
// a global, so set it here before Next is imported. This is required because we
// run the App Router through a custom server under `tsx` rather than `next dev`
// (which polyfills it itself).
import { AsyncLocalStorage } from "node:async_hooks";

const g = globalThis as unknown as { AsyncLocalStorage?: unknown };
if (!g.AsyncLocalStorage) {
  g.AsyncLocalStorage = AsyncLocalStorage;
}
```

The polyfill must run before `next` is imported, so it is the very first import in `server.ts`. ESM evaluates imports in source order, so a first-position import executes before any later import — including the `import next from "next"` line.

`server.ts` (top of file):

```ts
import "./lib/polyfills/async-local-storage";
import { createServer } from "node:http";
import next from "next";
// ...
```

Position is the entire fix: if the polyfill import appears after `import next from "next"`, Next's module evaluates first, the `FakeAsyncLocalStorage` path is selected, and the boot still crashes at the first render.

## Why This Works

The root cause is a missing runtime polyfill, not a misuse of the Next API. Two facts combine to produce the crash:

1. **Next only checks `globalThis.AsyncLocalStorage` once.** In `app-render/async-local-storage.js`, the presence of that global decides whether Next uses the real `AsyncLocalStorage` (which holds request/render context across async boundaries) or a `FakeAsyncLocalStorage`. The fake's `run()`/`enterWith()` throw the E504 invariant on first use.
2. **The global is set only on the `next dev`/`next start` code path.** Those entrypoints polyfill `globalThis.AsyncLocalStorage` from `node:async_hooks`. A custom server launched via `tsx server.ts` bypasses those entrypoints, so the global stays `undefined` and Next selects the throwing fake.

Node's `AsyncLocalStorage` is imported, not global, so the fix is to perform the exact polyfill that `next dev` would have done — assign `AsyncLocalStorage` (imported from `node:async_hooks`) to `globalThis.AsyncLocalStorage`. By doing it in the first-position ESM import, the global is populated before `next` is imported and before any App Router render can run. Once the global is present, Next's check selects the real implementation and renders proceed normally. The `if (!g.AsyncLocalStorage)` guard keeps the polyfill idempotent and safe under `next dev`, where the global is already set.

After the fix, the server boots cleanly; `/api/health` and `/` return 200; and the full end-to-end smoke test (a real `act --validate` dry-run passing, API guards, and graceful shutdown) works.

## Prevention

- **Polyfill `globalThis.AsyncLocalStorage` whenever you drive the Next.js App Router through a custom server under `tsx`/`ts-node`** (anything other than `next dev`/`next start`). Import the polyfill as the first line of the server entrypoint so it runs before `next`.
- **Add a boot smoke test.** After starting the server, curl `/api/health` and `/` and assert HTTP 200 before considering the boot successful. A regression that re-triggers the E504 crash fails this check immediately rather than silently at first render.
- **Don't trust static pages as a smoke test.** Statically prerendered routes never touch the App Router async store and can hide this class of bug; verify against at least one dynamic route.

## Related

- [vercel/next.js#69746](https://github.com/vercel/next.js/issues/69746) — exact error string (`AsyncLocalStorage accessed in runtime where it is not available`) and the Fake ALS fallback (closed).
- [vercel/next.js#86719](https://github.com/vercel/next.js/issues/86719) — `sharedAsyncLocalStorageNotAvailableError` on a 14 → 15 upgrade; same root cause (`globalThis.AsyncLocalStorage` absent), still open.
- [Next.js Custom Server guide](https://nextjs.org/docs/pages/guides/custom-server) — documents the custom-server runtime path that bypasses the `next dev` polyfill.
- `lib/polyfills/async-local-storage.ts` — the polyfill; its inline comment records the root cause.
