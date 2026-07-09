import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, type DB } from "./index";
import { RunsRepo } from "./runs-repo";

let db: DB;
let repo: RunsRepo;

beforeEach(() => {
  db = openDatabase(":memory:");
  repo = new RunsRepo(db);
});

describe("RunsRepo insert/get", () => {
  it("inserts a running run and retrieves it with id, status, and timestamps", () => {
    const run = repo.insertRun({
      workflow: ".github/workflows/ci.yml",
      job: null,
      event: "push",
      params: null,
    });
    expect(run.status).toBe("running");
    expect(run.id).toBeTruthy();
    expect(run.started_at).toBeTruthy();
    expect(run.ended_at).toBeNull();
    expect(run.duration_ms).toBeNull();

    const fetched = repo.getRun(run.id);
    expect(fetched?.workflow).toBe(".github/workflows/ci.yml");
    expect(fetched?.status).toBe("running");
  });
});

describe("appendLog ordering", () => {
  it("assigns sequence numbers automatically and returns logs in order", () => {
    const run = repo.insertRun({ workflow: "wf", job: null, event: "push", params: null });
    repo.appendLog({ run_id: run.id, job: "build", step: null, level: "info", message: "first" });
    repo.appendLog({ run_id: run.id, job: "build", step: null, level: "info", message: "second" });
    repo.appendLog({ run_id: run.id, job: "test", step: null, level: "info", message: "third" });

    const { logs } = repo.getRunWithLogs(run.id)!;
    expect(logs.map((l) => l.message)).toEqual(["first", "second", "third"]);
    expect(logs.map((l) => l.seq)).toEqual([0, 1, 2]);
  });
});

describe("updateStatus terminal-once", () => {
  it("transitions running -> passed and records duration and end time", () => {
    const run = repo.insertRun({ workflow: "wf", job: null, event: "push", params: null });
    expect(repo.updateStatus(run.id, "passed")).toBe(true);

    const fetched = repo.getRun(run.id)!;
    expect(fetched.status).toBe("passed");
    expect(fetched.ended_at).toBeTruthy();
    expect(fetched.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("is terminal-once: a second status update is a no-op", () => {
    const run = repo.insertRun({ workflow: "wf", job: null, event: "push", params: null });
    expect(repo.updateStatus(run.id, "passed")).toBe(true);
    expect(repo.updateStatus(run.id, "cancelled")).toBe(false);
    expect(repo.getRun(run.id)?.status).toBe("passed");
  });

  it("rejects a non-terminal status", () => {
    const run = repo.insertRun({ workflow: "wf", job: null, event: "push", params: null });
    expect(() => repo.updateStatus(run.id, "running")).toThrow();
  });
});

describe("reconcileStaleRuns", () => {
  it("marks a running row as failed and appends a diagnostic log", () => {
    const run = repo.insertRun({ workflow: "wf", job: null, event: "push", params: null });
    expect(repo.reconcileStaleRuns()).toBe(1);

    expect(repo.getRun(run.id)?.status).toBe("failed");
    const { logs } = repo.getRunWithLogs(run.id)!;
    expect(logs.some((l) => /interrupted/.test(l.message))).toBe(true);
  });

  it("leaves already-terminal runs untouched", () => {
    const run = repo.insertRun({ workflow: "wf", job: null, event: "push", params: null });
    repo.updateStatus(run.id, "passed");
    expect(repo.reconcileStaleRuns()).toBe(0);
    expect(repo.getRun(run.id)?.status).toBe("passed");
  });
});

describe("openDatabase idempotency", () => {
  it("re-opening an existing file db does not error or duplicate the schema", () => {
    const tmp = `/tmp/awui-test-${process.pid}-${Math.floor(Math.random() * 1e9)}.sqlite`;
    const a = openDatabase(tmp);
    a.prepare(
      "INSERT INTO runs (id, workflow, event, status, started_at) VALUES ('x','w','push','running','t')",
    ).run();
    a.close();

    const b = openDatabase(tmp); // CREATE IF NOT EXISTS is a no-op
    const row = b.prepare("SELECT COUNT(*) AS c FROM runs").get() as { c: number };
    expect(row.c).toBe(1);
    b.close();
  });
});
