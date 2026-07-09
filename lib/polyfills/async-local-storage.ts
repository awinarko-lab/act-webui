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
