import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RunRecord } from "@/lib/db/types";

// Mock only listRuns; keep the ApiError type and everything else real.
vi.mock("@/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/client")>(
    "@/lib/api/client",
  );
  return { ...actual, listRuns: vi.fn() };
});

import { listRuns } from "@/lib/api/client";
import RunsPage from "@/app/runs/page";

const mockedListRuns = vi.mocked(listRuns);

function makeRun(id: string): RunRecord {
  return {
    id,
    workflow: ".github/workflows/ci.yml",
    job: null,
    event: "push",
    params: null,
    status: "passed",
    started_at: "2026-07-09T00:00:00.000Z",
    ended_at: "2026-07-09T00:00:12.000Z",
    duration_ms: 12000,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RunsPage", () => {
  it("shows a loading state, then renders runs once they resolve", async () => {
    // A deferred promise keeps the page in its loading state until we resolve,
    // so the loading indicator is observable (mockResolvedValue would settle
    // within render's act flush before we could assert).
    let resolveRuns!: (value: { runs: RunRecord[] }) => void;
    mockedListRuns.mockReturnValue(
      new Promise<{ runs: RunRecord[] }>((resolve) => {
        resolveRuns = resolve;
      }),
    );

    render(<RunsPage />);

    expect(screen.getByTestId("runs-loading")).toBeInTheDocument();
    expect(mockedListRuns).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRuns({ runs: [makeRun("run-1")] });
    });

    await waitFor(() =>
      expect(screen.getByTestId("run-item-run-1")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("runs-loading")).not.toBeInTheDocument();
  });

  it("renders the empty state when the list comes back empty", async () => {
    mockedListRuns.mockResolvedValue({ runs: [] });

    render(<RunsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("run-history-empty")).toBeInTheDocument(),
    );
  });

  it("shows an error message and retries on click", async () => {
    const user = userEvent.setup();
    mockedListRuns
      .mockRejectedValueOnce(new Error("server is down"))
      .mockResolvedValueOnce({ runs: [makeRun("run-2")] });

    render(<RunsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("runs-error")).toHaveTextContent(
        "server is down",
      ),
    );

    await user.click(screen.getByTestId("runs-retry"));

    await waitFor(() =>
      expect(screen.getByTestId("run-item-run-2")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("runs-error")).not.toBeInTheDocument();
    expect(mockedListRuns).toHaveBeenCalledTimes(2);
  });
});
