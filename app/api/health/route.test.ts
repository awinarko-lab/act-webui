import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/act-detect", () => ({
  detectEnvironment: vi.fn(() => ({
    act: { installed: true, version: "0.2.89" },
    container: { runtime: "docker", available: true },
  })),
}));

import { detectEnvironment } from "@/lib/env/act-detect";
import { GET, __resetEnvCache } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    __resetEnvCache();
    vi.mocked(detectEnvironment).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns act + container availability as JSON", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      act: { installed: true, version: "0.2.89" },
      container: { runtime: "docker", available: true },
    });
  });

  it("caches detection: two rapid GETs within the TTL spawn once (S2)", async () => {
    await GET();
    await GET();
    expect(detectEnvironment).toHaveBeenCalledTimes(1);
  });

  it("keeps the response shape identical across cache hits (S2)", async () => {
    await GET();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      act: { installed: true, version: "0.2.89" },
      container: { runtime: "docker", available: true },
    });
  });

  it("re-spawns after the cache TTL elapses (S2)", async () => {
    vi.useFakeTimers();
    await GET();
    expect(detectEnvironment).toHaveBeenCalledTimes(1);
    // Advance past the 5s TTL.
    vi.advanceTimersByTime(5_001);
    await GET();
    expect(detectEnvironment).toHaveBeenCalledTimes(2);
  });
});
