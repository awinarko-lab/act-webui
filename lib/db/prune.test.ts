import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, type DB } from "./index";
import { RunsRepo, historyLimit } from "./runs-repo";

let db: DB;
let repo: RunsRepo;

beforeEach(() => {
  db = openDatabase(":memory:");
  repo = new RunsRepo(db);
});

afterEach(() => {
  delete process.env.HISTORY_LIMIT;
});

function insertRuns(n: number, terminal = true): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const run = repo.insertRun({ workflow: "wf", job: null, event: "push", params: null });
    if (terminal) repo.updateStatus(run.id, "passed");
    ids.push(run.id);
  }
  return ids;
}

describe("pruneToLimit (keep-last-N)", () => {
  it("after N+1 terminal runs, prunes the oldest run AND its logs", () => {
    const ids = insertRuns(3);
    repo.appendLog({ run_id: ids[0], job: null, step: null, level: "info", message: "log" });

    const deleted = repo.pruneToLimit(2);
    expect(deleted).toBe(1);
    expect(repo.getRun(ids[0])).toBeUndefined(); // oldest gone
    expect(repo.getRun(ids[1])).toBeDefined();
    expect(repo.getRun(ids[2])).toBeDefined();
    expect(repo.getRunWithLogs(ids[0])).toBeUndefined(); // logs cascade-deleted
  });

  it("never prunes a run still in running status", () => {
    const running = repo.insertRun({ workflow: "wf", job: null, event: "push", params: null });
    insertRuns(2, true); // 2 terminal
    repo.pruneToLimit(2); // terminal set has 2 (<= limit) -> nothing pruned; running untouched
    expect(repo.getRun(running.id)?.status).toBe("running");
  });

  it("never prunes a running row even when many terminal runs are pruned", () => {
    insertRuns(3, true); // 3 terminal
    const running = repo.insertRun({ workflow: "wf", job: null, event: "push", params: null });
    repo.pruneToLimit(2); // prunes the oldest terminal run; running survives
    expect(repo.getRun(running.id)?.status).toBe("running");
  });

  it("respects a configured HISTORY_LIMIT", () => {
    process.env.HISTORY_LIMIT = "3";
    expect(historyLimit()).toBe(3);
    const ids = insertRuns(5);
    const deleted = repo.pruneToLimit(); // uses historyLimit() = 3
    expect(deleted).toBe(2);
    expect(repo.getRun(ids[0])).toBeUndefined();
    expect(repo.getRun(ids[1])).toBeUndefined();
    expect(repo.listRuns().length).toBe(3);
  });
});
