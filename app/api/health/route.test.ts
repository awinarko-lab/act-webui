import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env/act-detect", () => ({
  detectEnvironment: () => ({
    act: { installed: true, version: "0.2.89" },
    container: { runtime: "docker", available: true },
  }),
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns act + container availability as JSON", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      act: { installed: true, version: "0.2.89" },
      container: { runtime: "docker", available: true },
    });
  });
});
