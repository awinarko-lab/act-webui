import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RunTriggerPanel, type RunPayload } from "@/components/run-trigger-panel";
import type { DiscoveredWorkflow } from "@/lib/discovery/types";

const workflow: DiscoveredWorkflow = {
  path: ".github/workflows/ci.yml",
  name: "CI",
  events: ["push", "pull_request"],
  jobs: [
    { id: "build", name: null, needs: [], steps: [] },
    { id: "test", name: null, needs: ["build"], steps: [] },
  ],
};

afterEach(() => cleanup());

describe("RunTriggerPanel", () => {
  it("calls onRun with defaults (all jobs, first event, dry-run off) when Run is clicked", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();

    render(<RunTriggerPanel workflow={workflow} onRun={onRun} />);

    await user.click(screen.getByTestId("run-button"));

    expect(onRun).toHaveBeenCalledTimes(1);
    const payload: RunPayload = onRun.mock.calls[0][0];
    expect(payload).toEqual({
      workflow: ".github/workflows/ci.yml",
      job: null,
      event: "push",
      dryRun: false,
    });
  });

  it("reflects the selected job, event, and dry-run in the onRun payload", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();

    render(<RunTriggerPanel workflow={workflow} onRun={onRun} />);

    await user.selectOptions(screen.getByTestId("job-select"), "test");
    await user.selectOptions(screen.getByTestId("event-select"), "pull_request");
    await user.click(screen.getByTestId("dry-run-checkbox"));
    await user.click(screen.getByTestId("run-button"));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0][0]).toEqual({
      workflow: ".github/workflows/ci.yml",
      job: "test",
      event: "pull_request",
      dryRun: true,
    });
  });

  it("disables the Run button while submitting", () => {
    render(<RunTriggerPanel workflow={workflow} submitting onRun={() => {}} />);

    expect(screen.getByTestId("run-button")).toBeDisabled();
    // Still shows a loading label.
    expect(screen.getByTestId("run-button")).toHaveTextContent("Starting…");
  });

  it("renders the empty prompt when no workflow is selected", () => {
    render(<RunTriggerPanel workflow={null} onRun={() => {}} />);

    expect(screen.getByTestId("trigger-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("trigger-form")).not.toBeInTheDocument();
  });

  it("renders a trigger error message when provided", () => {
    render(
      <RunTriggerPanel
        workflow={workflow}
        error="act is not installed"
        onRun={() => {}}
      />,
    );

    expect(screen.getByTestId("trigger-error")).toHaveTextContent(
      "act is not installed",
    );
  });
});
