import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/discovery");

import { discoverWorkflows } from "@/lib/discovery";

import { GET } from "./route";

const mockDiscover = vi.mocked(discoverWorkflows);

beforeEach(() => {
  mockDiscover.mockReset();
});

describe("GET /api/workflows", () => {
  it("returns the parsed workflows and per-file errors", async () => {
    mockDiscover.mockReturnValue({
      workflows: [
        {
          path: ".github/workflows/ci.yml",
          name: "CI",
          events: ["push"],
          jobs: [],
        },
      ],
      errors: [{ path: ".github/workflows/bad.yml", message: "boom" }],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      workflows: [
        {
          path: ".github/workflows/ci.yml",
          name: "CI",
          events: ["push"],
          jobs: [],
        },
      ],
      errors: [{ path: ".github/workflows/bad.yml", message: "boom" }],
    });
    expect(mockDiscover).toHaveBeenCalledOnce();
  });

  it("returns empty lists when discovery finds nothing", async () => {
    mockDiscover.mockReturnValue({ workflows: [], errors: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workflows: [], errors: [] });
  });
});
