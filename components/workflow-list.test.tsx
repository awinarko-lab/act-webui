import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkflowList } from "@/components/workflow-list";
import type {
  DiscoveredWorkflow,
  DiscoveryError,
} from "@/lib/discovery/types";

function makeWorkflow(
  over: Partial<DiscoveredWorkflow> & { path: string },
): DiscoveredWorkflow {
  return {
    name: over.path,
    events: [],
    jobs: [],
    ...over,
  };
}

afterEach(() => cleanup());

describe("WorkflowList", () => {
  it("renders workflows with their jobs and events", () => {
    const workflows = [
      makeWorkflow({
        path: ".github/workflows/ci.yml",
        name: "CI",
        events: ["push", "pull_request"],
        jobs: [
          { id: "build", name: null, needs: [], steps: [] },
          { id: "test", name: null, needs: ["build"], steps: [] },
        ],
      }),
    ];

    render(
      <WorkflowList
        workflows={workflows}
        onSelect={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText("CI")).toBeInTheDocument();
    expect(screen.getByText(".github/workflows/ci.yml")).toBeInTheDocument();
    expect(screen.getByText("push")).toBeInTheDocument();
    expect(screen.getByText("pull_request")).toBeInTheDocument();
    // Job ids are rendered as a comma-separated list.
    expect(screen.getByText("build, test")).toBeInTheDocument();
  });

  it("calls onSelect with the workflow path when an item is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const workflows = [
      makeWorkflow({ path: ".github/workflows/ci.yml", name: "CI" }),
      makeWorkflow({ path: ".github/workflows/release.yml", name: "Release" }),
    ];

    render(
      <WorkflowList workflows={workflows} onSelect={onSelect} onRefresh={() => {}} />,
    );

    await user.click(screen.getByTestId("workflow-item-.github/workflows/release.yml"));

    expect(onSelect).toHaveBeenCalledWith(".github/workflows/release.yml");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onRefresh when the refresh button is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    render(
      <WorkflowList workflows={[]} onSelect={() => {}} onRefresh={onRefresh} />,
    );

    await user.click(screen.getByTestId("workflow-refresh"));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("surfaces discovery errors as a warning list", () => {
    const errors: DiscoveryError[] = [
      { path: ".github/workflows/broken.yml", message: "invalid YAML" },
    ];

    render(
      <WorkflowList
        workflows={[]}
        errors={errors}
        onSelect={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByTestId("workflow-errors")).toBeInTheDocument();
    expect(screen.getByText(".github/workflows/broken.yml")).toBeInTheDocument();
    expect(screen.getByText(/invalid YAML/)).toBeInTheDocument();
  });

  it("renders an empty state when there are no workflows and no errors", () => {
    render(
      <WorkflowList workflows={[]} onSelect={() => {}} onRefresh={() => {}} />,
    );

    expect(screen.getByTestId("workflow-empty")).toBeInTheDocument();
  });

  it("marks the selected workflow path as pressed", () => {
    render(
      <WorkflowList
        workflows={[
          makeWorkflow({ path: ".github/workflows/ci.yml", name: "CI" }),
        ]}
        selectedPath=".github/workflows/ci.yml"
        onSelect={() => {}}
        onRefresh={() => {}}
      />,
    );

    const item = screen.getByTestId("workflow-item-.github/workflows/ci.yml");
    expect(item).toHaveAttribute("aria-pressed", "true");
  });
});
