// Adds jest-dom matchers (e.g. toBeInTheDocument) to Vitest's `expect` for all
// tests. Safe in the node environment too — it only augments matchers; the DOM
// is only touched when a matcher that needs it is actually invoked.
import "@testing-library/jest-dom/vitest";
