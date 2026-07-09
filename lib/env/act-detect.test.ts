import { describe, it, expect } from "vitest";
import {
  parseActVersion,
  getActInfo,
  getContainerInfo,
  detectEnvironment,
  type Runner,
  type SpawnResult,
} from "./act-detect";

const ok = (stdout: string): SpawnResult => ({ status: 0, stdout, stderr: "" });
const fail: SpawnResult = { status: 1, stdout: "", stderr: "command not found" };

describe("parseActVersion", () => {
  it("extracts the version from `act --version` output", () => {
    expect(parseActVersion("act version 0.2.89\n")).toBe("0.2.89");
  });

  it("returns undefined when no version is present", () => {
    expect(parseActVersion("command not found")).toBeUndefined();
  });
});

describe("getActInfo", () => {
  it("reports installed when `act --version` succeeds", () => {
    const runner: Runner = () => ok("act version 0.2.89\n");
    expect(getActInfo(runner)).toEqual({ installed: true, version: "0.2.89" });
  });

  it("reports missing when `act --version` fails", () => {
    const runner: Runner = () => fail;
    expect(getActInfo(runner)).toEqual({ installed: false });
  });
});

describe("getContainerInfo", () => {
  it("prefers docker when its daemon responds", () => {
    const runner: Runner = (cmd) => (cmd === "docker" ? ok("") : fail);
    expect(getContainerInfo(runner)).toEqual({ runtime: "docker", available: true });
  });

  it("falls back to podman when docker is absent", () => {
    const runner: Runner = (cmd) => (cmd === "podman" ? ok("podman version 5") : fail);
    expect(getContainerInfo(runner)).toEqual({ runtime: "podman", available: true });
  });

  it("reports unavailable when neither responds", () => {
    const runner: Runner = () => fail;
    expect(getContainerInfo(runner)).toEqual({ runtime: null, available: false });
  });
});

describe("detectEnvironment", () => {
  it("combines act and container detection", () => {
    const runner: Runner = (cmd) => (cmd === "act" ? ok("act version 0.2.89\n") : fail);
    const env = detectEnvironment(runner);
    expect(env.act).toEqual({ installed: true, version: "0.2.89" });
    expect(env.container).toEqual({ runtime: null, available: false });
  });
});
