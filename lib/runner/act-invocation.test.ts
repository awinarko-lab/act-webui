import { describe, it, expect } from "vitest";
import {
  buildInvocation,
  interpretValidation,
  DEFAULT_EVENT,
} from "./act-invocation";
import { InvalidInvocationError } from "./types";

describe("buildInvocation vector shape (AE11)", () => {
  it("whole-workflow: positional event + -W + --json", () => {
    expect(buildInvocation({ workflow: ".github/workflows/ci.yml" })).toEqual([
      "push",
      "-W",
      ".github/workflows/ci.yml",
      "--json",
    ]);
  });

  it("uses -j to scope to a single job", () => {
    expect(
      buildInvocation({ workflow: ".github/workflows/ci.yml", job: "build" }),
    ).toEqual([
      "push",
      "-W",
      ".github/workflows/ci.yml",
      "-j",
      "build",
      "--json",
    ]);
  });

  it("uses the event as the positional argument", () => {
    expect(
      buildInvocation({
        workflow: ".github/workflows/ci.yml",
        event: "workflow_dispatch",
      }),
    ).toEqual([
      "workflow_dispatch",
      "-W",
      ".github/workflows/ci.yml",
      "--json",
    ]);
  });

  it("dry-run adds --validate before --json", () => {
    expect(
      buildInvocation({ workflow: ".github/workflows/ci.yml", dryRun: true }),
    ).toEqual([
      "push",
      "-W",
      ".github/workflows/ci.yml",
      "--validate",
      "--json",
    ]);
  });

  it("combines single-job + event + dry-run", () => {
    expect(
      buildInvocation({
        workflow: ".github/workflows/ci.yml",
        job: "test",
        event: "pull_request",
        dryRun: true,
      }),
    ).toEqual([
      "pull_request",
      "-W",
      ".github/workflows/ci.yml",
      "-j",
      "test",
      "--validate",
      "--json",
    ]);
  });

  it("accepts the .yaml extension and defaults event to push", () => {
    expect(DEFAULT_EVENT).toBe("push");
    const v = buildInvocation({ workflow: ".github/workflows/deploy.yaml" });
    expect(v[0]).toBe("push");
    expect(v[2]).toBe(".github/workflows/deploy.yaml");
  });
});

describe("buildInvocation sanitization (KTD9)", () => {
  it("rejects a path-traversal workflow", () => {
    const err = capture(() =>
      buildInvocation({ workflow: "../etc/passwd" }),
    );
    expect(err).toBeInstanceOf(InvalidInvocationError);
    expect(err!.field).toBe("workflow");
  });

  it("rejects a workflow outside the allowlisted directory", () => {
    expect(() => buildInvocation({ workflow: "workflows/ci.yml" })).toThrow(
      InvalidInvocationError,
    );
  });

  it("rejects a nested path under workflows/", () => {
    expect(() =>
      buildInvocation({ workflow: ".github/workflows/sub/ci.yml" }),
    ).toThrow(InvalidInvocationError);
  });

  it("rejects a non-yml/yaml extension", () => {
    expect(() =>
      buildInvocation({ workflow: ".github/workflows/ci.txt" }),
    ).toThrow(InvalidInvocationError);
  });

  it("rejects a path-like job id", () => {
    expect(() =>
      buildInvocation({
        workflow: ".github/workflows/ci.yml",
        job: "a/b",
      }),
    ).toThrow(InvalidInvocationError);
  });

  it("rejects a job id with shell metacharacters", () => {
    expect(() =>
      buildInvocation({
        workflow: ".github/workflows/ci.yml",
        job: "rm -rf",
      }),
    ).toThrow(InvalidInvocationError);
  });

  it("rejects a path-like / injected event", () => {
    expect(() =>
      buildInvocation({
        workflow: ".github/workflows/ci.yml",
        event: "push;evil",
      }),
    ).toThrow(InvalidInvocationError);
  });

  it("rejects an event with a path separator", () => {
    expect(() =>
      buildInvocation({
        workflow: ".github/workflows/ci.yml",
        event: "../x",
      }),
    ).toThrow(InvalidInvocationError);
  });
});

describe("interpretValidation (AE3/AE4 exit-code → validity mapping)", () => {
  it("exit 0 → valid", () => {
    expect(interpretValidation(0, ["ignored"])).toEqual({
      valid: true,
      exitCode: 0,
    });
  });

  it("exit 1 with a YAML error line → invalid with that reason", () => {
    const lines = [
      '{"level":"info","msg":"Using docker host unix:///var/run/docker.sock"}',
      "Error: workflow is not valid. 'bad.yml': yaml: line 1: did not find expected ',' or ']'",
    ];
    const r = interpretValidation(1, lines);
    expect(r.valid).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.reason).toMatch(/not valid/);
  });

  it("falls back to the exit code when no informative line is present", () => {
    const r = interpretValidation(1, []);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/code 1/);
  });

  it("null exit code (signal) is treated as invalid", () => {
    const r = interpretValidation(null, []);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/code null/);
  });
});

function capture(fn: () => void): InvalidInvocationError | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof InvalidInvocationError) return e;
    throw e;
  }
  return undefined;
}
