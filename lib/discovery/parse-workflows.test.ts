import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverWorkflows, parseEvents, parseNeeds } from "./parse-workflows";

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "awui-disc-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, ".github", "workflows", name), content);
  }
  return root;
}

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("parseEvents / parseNeeds", () => {
  it("parses on: as a string", () => {
    expect(parseEvents("push")).toEqual(["push"]);
  });
  it("parses on: as an array", () => {
    expect(parseEvents(["push", "pull_request"])).toEqual(["push", "pull_request"]);
  });
  it("parses on: as a map (keys are the events)", () => {
    expect(parseEvents({ push: {}, workflow_dispatch: { inputs: {} } })).toEqual([
      "push",
      "workflow_dispatch",
    ]);
  });
  it("parses needs as a comma string or an array", () => {
    expect(parseNeeds("a, b")).toEqual(["a", "b"]);
    expect(parseNeeds(["lint", "build"])).toEqual(["lint", "build"]);
  });
});

describe("discoverWorkflows", () => {
  it("returns workflows with name, events, jobs, and needs", () => {
    const root = makeRepo({
      "ci.yml": `name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    needs: [lint]\n    steps:\n      - name: Build\n        run: echo build\n`,
      "deploy.yml": `name: Deploy\non: [push, workflow_dispatch]\njobs:\n  lint:\n    name: Lint\n    steps:\n      - uses: actions/checkout@v4\n`,
    });
    roots.push(root);

    const { workflows, errors } = discoverWorkflows(root);
    expect(errors).toEqual([]);

    const ci = workflows.find((w) => w.name === "CI")!;
    expect(ci.events).toEqual(["push"]);
    expect(ci.path).toBe(".github/workflows/ci.yml");
    const build = ci.jobs.find((j) => j.id === "build")!;
    expect(build.needs).toEqual(["lint"]);
    expect(build.steps[0]).toMatchObject({ name: "Build", run: "echo build" });

    const deploy = workflows.find((w) => w.name === "Deploy")!;
    expect(deploy.events).toEqual(["push", "workflow_dispatch"]);
    expect(deploy.jobs[0].steps[0].uses).toBe("actions/checkout@v4");
  });

  it("handles all three on: forms across files", () => {
    const root = makeRepo({
      "a.yml": `on: push\njobs:\n  x:\n    steps: []\n`,
      "b.yml": `on: [push, pull_request]\njobs:\n  x:\n    steps: []\n`,
      "c.yml": `on:\n  schedule:\n    - cron: '0 0 * * *'\n  workflow_dispatch: {}\njobs:\n  x:\n    steps: []\n`,
    });
    roots.push(root);
    const byName = Object.fromEntries(
      discoverWorkflows(root).workflows.map((w) => [w.path, w.events]),
    );
    expect(byName[".github/workflows/a.yml"]).toEqual(["push"]);
    expect(byName[".github/workflows/b.yml"]).toEqual(["push", "pull_request"]);
    expect(byName[".github/workflows/c.yml"]).toEqual(["schedule", "workflow_dispatch"]);
  });

  it("surfaces malformed/non-workflow files as per-file errors while valid files still list (AE2)", () => {
    const root = makeRepo({
      "good.yml": `name: Good\non: push\njobs:\n  x:\n    steps: []\n`,
      "string.yml": `just a plain string, not a mapping\n`, // parses, but not a workflow
      "broken.yml": "name: Broken\n\ton: push\n", // tab indentation -> YAML parse error
    });
    roots.push(root);
    const { workflows, errors } = discoverWorkflows(root);
    expect(workflows.map((w) => w.name)).toEqual(["Good"]);
    expect(errors.map((e) => e.path).sort()).toEqual([
      ".github/workflows/broken.yml",
      ".github/workflows/string.yml",
    ]);
  });

  it("returns an empty list with no error when the workflows dir is empty or missing", () => {
    const root = mkdtempSync(join(tmpdir(), "awui-disc-")); // no .github/workflows
    roots.push(root);
    const result = discoverWorkflows(root);
    expect(result.workflows).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("picks up a workflow added after the first discovery (AE12)", () => {
    const root = makeRepo({ "first.yml": `name: First\non: push\njobs:\n  x:\n    steps: []\n` });
    roots.push(root);
    expect(discoverWorkflows(root).workflows).toHaveLength(1);
    writeFileSync(
      join(root, ".github", "workflows", "second.yml"),
      `name: Second\non: push\njobs:\n  x:\n    steps: []\n`,
    );
    expect(discoverWorkflows(root).workflows.map((w) => w.name)).toEqual(["First", "Second"]);
  });
});
