import { spawnSync } from "node:child_process";

export type SpawnResult = { status: number | null; stdout: string; stderr: string };

/** A subprocess runner. Injectable so tests can fake act/docker presence. */
export type Runner = (command: string, args: string[]) => SpawnResult;

const defaultRunner: Runner = (command, args) =>
  spawnSync(command, args, { encoding: "utf-8", timeout: 15_000 });

export interface ActInfo {
  installed: boolean;
  version?: string;
}

export interface ContainerInfo {
  runtime: "docker" | "podman" | null;
  available: boolean;
}

export interface EnvironmentInfo {
  act: ActInfo;
  container: ContainerInfo;
}

/** Parse the version from `act --version` output (e.g. "act version 0.2.89"). */
export function parseActVersion(stdout: string): string | undefined {
  const match = stdout.match(/act version\s+(\S+)/i);
  return match?.[1];
}

export function getActInfo(runner: Runner = defaultRunner): ActInfo {
  const result = runner("act", ["--version"]);
  if (result.status === 0) {
    return { installed: true, version: parseActVersion(result.stdout) };
  }
  return { installed: false };
}

export function getContainerInfo(runner: Runner = defaultRunner): ContainerInfo {
  // `docker info` checks the daemon is actually running, not just that the CLI
  // is installed.
  const docker = runner("docker", ["info"]);
  if (docker.status === 0) return { runtime: "docker", available: true };

  const podman = runner("podman", ["--version"]);
  if (podman.status === 0) return { runtime: "podman", available: true };

  return { runtime: null, available: false };
}

export function detectEnvironment(runner: Runner = defaultRunner): EnvironmentInfo {
  return { act: getActInfo(runner), container: getContainerInfo(runner) };
}
