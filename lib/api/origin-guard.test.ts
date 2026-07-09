import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { allowedOrigin, assertSameOrigin } from "./origin-guard";

const ENV_KEYS = ["ALLOWED_ORIGIN", "HOST", "PORT"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

function postReq(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/runs", {
    method: "POST",
    headers,
  });
}

describe("origin-guard allowedOrigin()", () => {
  it("defaults to the localhost dashboard URL", () => {
    expect(allowedOrigin()).toBe("http://127.0.0.1:3000");
  });

  it("derives the URL from HOST and PORT", () => {
    process.env.HOST = "dashboard.local";
    process.env.PORT = "8080";
    expect(allowedOrigin()).toBe("http://dashboard.local:8080");
  });

  it("ALLOWED_ORIGIN takes precedence over HOST/PORT", () => {
    process.env.HOST = "ignored";
    process.env.PORT = "1";
    process.env.ALLOWED_ORIGIN = "https://ci.example.com";
    expect(allowedOrigin()).toBe("https://ci.example.com");
  });
});

describe("origin-guard assertSameOrigin()", () => {
  it("accepts an Origin header equal to the allowed origin", () => {
    process.env.ALLOWED_ORIGIN = "http://dashboard.local:3000";
    expect(
      assertSameOrigin(postReq({ origin: "http://dashboard.local:3000" })),
    ).toBeNull();
  });

  it("rejects a mismatched Origin with 403 and a stable message", async () => {
    process.env.ALLOWED_ORIGIN = "http://dashboard.local:3000";
    const res = assertSameOrigin(postReq({ origin: "https://evil.example" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(await res!.json()).toEqual({ error: "cross-origin request rejected" });
  });

  it("accepts an absent Origin when Host matches the allowed authority", () => {
    process.env.ALLOWED_ORIGIN = "http://dashboard.local:3000";
    expect(
      assertSameOrigin(postReq({ host: "dashboard.local:3000" })),
    ).toBeNull();
  });

  it("rejects an absent Origin when Host differs", () => {
    process.env.ALLOWED_ORIGIN = "http://dashboard.local:3000";
    const res = assertSameOrigin(postReq({ host: "evil.example" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("handles an ALLOWED_ORIGIN without an explicit port", () => {
    process.env.ALLOWED_ORIGIN = "https://ci.example.com";
    // Origin match.
    expect(
      assertSameOrigin(postReq({ origin: "https://ci.example.com" })),
    ).toBeNull();
    // Host match — authority has no port.
    expect(assertSameOrigin(postReq({ host: "ci.example.com" }))).toBeNull();
    // Mismatch.
    const res = assertSameOrigin(postReq({ host: "evil.example" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});
