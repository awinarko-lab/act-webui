import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RunHistoryList } from "@/components/run-history-list";
import type { RunRecord } from "@/lib/db/types";

/** Builds a complete RunRecord, applying partial overrides over a sane default. */
function makeRun(over: Partial<RunRecord> & { id: string }): RunRecord {
  return {
    workflow: ".github/workflows/ci.yml",
    job: null,
    event: "push",
    params: null,
    status: "passed",
    started_at: "2026-07-09T00:00:00.000Z",
    ended_at: "2026-07-09T00:00:12.000Z",
    duration_ms: 12000,
    ...over,
  };
}

afterEach(() => cleanup());

describe("RunHistoryList", () => {
  it("renders each run with its status, duration, and timestamp", () => {
    const runs = [
      makeRun({
        id: "run-1",
        status: "passed",
        duration_ms: 12000,
        started_at: "2026-07-09T00:00:00.000Z",
      }),
      makeRun({
        id: "run-2",
        status: "running",
        duration_ms: null,
        ended_at: null,
      }),
    ];

    render(<RunHistoryList runs={runs} />);

    // Workflow path renders for each run.
    expect(screen.getAllByText(".github/workflows/ci.yml")).toHaveLength(2);
    // Reused StatusBadge renders the per-run status label. Scoped to the run
    // item so it doesn't collide with the filter-chip labels ("Passed"/"Running").
    expect(
      within(screen.getByTestId("run-item-run-1")).getByText("Passed"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("run-item-run-2")).getByText("Running"),
    ).toBeInTheDocument();
    // Formatted durations: 12000ms -> "12.0s"; in-progress -> em dash.
    expect(
      within(screen.getByTestId("run-item-run-1")).getByText("12.0s"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("run-item-run-2")).getByText("—"),
    ).toBeInTheDocument();
    // Raw ISO timestamp is carried as a tooltip title for stability.
    expect(
      within(screen.getByTestId("run-item-run-1")).getByTitle(
        "2026-07-09T00:00:00.000Z",
      ),
    ).toBeInTheDocument();
  });

  it("shows the scoped job alongside the workflow when a run is job-scoped", () => {
    render(<RunHistoryList runs={[makeRun({ id: "run-1", job: "build" })]} />);

    expect(screen.getByText("build")).toBeInTheDocument();
  });

  it("links each run to its detail page", () => {
    render(<RunHistoryList runs={[makeRun({ id: "run-42" })]} />);

    expect(screen.getByTestId("run-item-run-42")).toHaveAttribute(
      "href",
      "/runs/run-42",
    );
  });

  it("renders an empty state with a link home when there are no runs", () => {
    render(<RunHistoryList runs={[]} />);

    expect(screen.getByTestId("run-history-empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /home page/i })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("filters runs by status", async () => {
    const user = userEvent.setup();
    render(
      <RunHistoryList
        runs={[
          makeRun({ id: "run-1", status: "passed" }),
          makeRun({ id: "run-2", status: "failed" }),
        ]}
      />,
    );

    // Both runs are visible under the default "all" filter.
    expect(screen.getByTestId("run-item-run-1")).toBeInTheDocument();
    expect(screen.getByTestId("run-item-run-2")).toBeInTheDocument();

    await user.click(screen.getByTestId("filter-failed"));

    expect(screen.queryByTestId("run-item-run-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("run-item-run-2")).toBeInTheDocument();
  });

  it("renders a filter empty state when no run matches the active filter", async () => {
    const user = userEvent.setup();
    render(
      <RunHistoryList
        runs={[makeRun({ id: "run-1", status: "passed" })]}
      />,
    );

    await user.click(screen.getByTestId("filter-failed"));

    expect(screen.getByTestId("run-history-filter-empty")).toBeInTheDocument();
  });
});
