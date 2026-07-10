import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { LogViewer } from "@/components/log-viewer";
import type { RunLogLine } from "@/lib/db/types";

function makeLine(over: Partial<RunLogLine> & { message: string }): RunLogLine {
  return {
    run_id: "run-1",
    seq: 0,
    job: null,
    step: null,
    level: null,
    ts: "2026-07-09T00:00:00.000Z",
    ...over,
  };
}

afterEach(() => cleanup());

describe("LogViewer", () => {
  it("renders an empty state when there are no logs", () => {
    render(<LogViewer logs={[]} />);
    expect(screen.getByTestId("log-viewer-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("log-viewer")).not.toBeInTheDocument();
  });

  it("groups lines by job and renders each group", () => {
    const logs: RunLogLine[] = [
      makeLine({ seq: 0, job: "build", message: "building" }),
      makeLine({ seq: 1, job: "build", message: "built artifact" }),
      makeLine({ seq: 2, job: "test", message: "testing" }),
    ];

    render(<LogViewer logs={logs} />);

    const buildGroup = screen.getByTestId("log-group-build");
    const testGroup = screen.getByTestId("log-group-test");
    expect(buildGroup).toBeInTheDocument();
    expect(testGroup).toBeInTheDocument();

    expect(buildGroup).toHaveTextContent("building");
    expect(buildGroup).toHaveTextContent("built artifact");
    expect(buildGroup).not.toHaveTextContent("testing");
    expect(testGroup).toHaveTextContent("testing");
  });

  it("applies level-specific styling to a line", () => {
    const logs: RunLogLine[] = [
      makeLine({ seq: 0, job: "build", level: "error", message: "boom" }),
      makeLine({ seq: 1, job: "build", level: "info", message: "ok" }),
    ];

    render(<LogViewer logs={logs} />);

    // The message span carries the level color class. Colors are fixed light
    // variants because the log panel always renders on a dark background.
    const errorLine = screen.getByText("boom");
    expect(errorLine).toHaveClass("text-red-400");

    const infoLine = screen.getByText("ok");
    expect(infoLine).toHaveClass("text-zinc-100");
    expect(infoLine).not.toHaveClass("text-red-400");
  });

  it("renders without throwing as logs grow (auto-scroll hook is safe)", () => {
    const { rerender } = render(<LogViewer logs={[makeLine({ message: "a" })]} />);
    expect(screen.getByText("a")).toBeInTheDocument();

    // Simulate a live stream appending lines.
    expect(() =>
      rerender(
        <LogViewer
          logs={[
            makeLine({ seq: 0, message: "a" }),
            makeLine({ seq: 1, message: "b" }),
            makeLine({ seq: 2, message: "c" }),
          ]}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
  });

  it("groups lines without a job under an ungrouped bucket", () => {
    const logs: RunLogLine[] = [
      makeLine({ seq: 0, job: null, message: "loose line" }),
    ];

    render(<LogViewer logs={logs} />);

    expect(screen.getByTestId("log-group-ungrouped")).toHaveTextContent(
      "loose line",
    );
  });
});
