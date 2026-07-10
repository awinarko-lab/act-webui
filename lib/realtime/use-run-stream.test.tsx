// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("socket.io-client", () => ({ io: vi.fn() }));

import { io } from "socket.io-client";
import type { RunRecord } from "@/lib/db/types";
import { LOG_EVENT, RUN_COMPLETE, RUN_STATUS, SUBSCRIBE } from "@/lib/realtime/events";
import { useRunStream } from "@/lib/realtime/use-run-stream";

const mockedIo = vi.mocked(io);

/**
 * A controllable Socket stand-in. The hook calls `emit` (to send `subscribe`)
 * and `disconnect` (on unmount), and registers `on` listeners that this mock
 * drives via `__receive` (backed by a real EventEmitter).
 */
interface MockSocket {
  on: (ev: string, cb: (...args: unknown[]) => void) => void;
  emit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  connected: boolean;
  __receive: (ev: string, payload: unknown) => void;
}

function createMockSocket(): MockSocket {
  const ee = new EventEmitter();
  return {
    on: (ev, cb) => {
      ee.on(ev, cb as (...a: unknown[]) => void);
    },
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: true,
    __receive: (ev, payload) => {
      ee.emit(ev, payload);
    },
  };
}

function Probe({ runId }: { runId: string | null }) {
  const { run, logs, status } = useRunStream(runId);
  return (
    <div>
      <span data-testid="status">{status ?? "none"}</span>
      <span data-testid="run">{run?.id ?? "none"}</span>
      <ul data-testid="logs">
        {logs.map((l, i) => (
          <li key={`${l.seq}-${i}`}>{l.message}</li>
        ))}
      </ul>
    </div>
  );
}

const baseRun: RunRecord = {
  id: "run-1",
  workflow: ".github/workflows/ci.yml",
  job: null,
  event: "push",
  params: null,
  status: "running",
  started_at: "2026-07-09T00:00:00.000Z",
  ended_at: null,
  duration_ms: null,
};

describe("useRunStream", () => {
  let mockSocket: MockSocket;

  beforeEach(() => {
    mockSocket = createMockSocket();
    mockedIo.mockReturnValue(mockSocket as unknown as ReturnType<typeof io>);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("seeds state from GET /api/runs/[id] on mount and subscribes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          run: baseRun,
          logs: [
            {
              run_id: "run-1",
              seq: 0,
              job: "build",
              step: "s",
              level: "info",
              message: "seeded",
              ts: "2026-07-09T00:00:01.000Z",
            },
          ],
        }),
      }),
    );

    render(<Probe runId="run-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("running"),
    );
    expect(screen.getByTestId("run").textContent).toBe("run-1");
    expect(screen.getByTestId("logs").textContent).toContain("seeded");
    expect(mockSocket.emit).toHaveBeenCalledWith(SUBSCRIBE, { runId: "run-1" });
  });

  it("appends a live log:event and updates status from the socket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ run: baseRun, logs: [] }),
      }),
    );

    render(<Probe runId="run-1" />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("running"),
    );

    act(() => {
      mockSocket.__receive(LOG_EVENT, {
        runId: "run-1",
        job: "test",
        step: "test",
        level: "info",
        message: "live line",
        ts: "2026-07-09T00:00:02.000Z",
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("logs").textContent).toContain("live line"),
    );

    act(() => {
      mockSocket.__receive(RUN_STATUS, { runId: "run-1", status: "passed" });
    });
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("passed"),
    );
  });

  it("dedups a replayed persisted line against the HTTP seed by seq", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          run: baseRun,
          logs: [
            {
              run_id: "run-1",
              seq: 0,
              job: "build",
              step: "s",
              level: "info",
              message: "seeded",
              ts: "2026-07-09T00:00:01.000Z",
            },
          ],
        }),
      }),
    );

    render(<Probe runId="run-1" />);
    await waitFor(() =>
      expect(screen.getByTestId("logs").textContent).toContain("seeded"),
    );

    // The server replays the same persisted line (seq 0) on subscribe; the hook
    // must not duplicate it.
    act(() => {
      mockSocket.__receive(LOG_EVENT, {
        runId: "run-1",
        seq: 0,
        job: "build",
        step: "s",
        level: "info",
        message: "seeded",
        ts: "2026-07-09T00:00:01.000Z",
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("logs").textContent).toContain("seeded"),
    );
    expect(screen.getByTestId("logs").textContent).toBe("seeded");
  });

  it("does not let a stale HTTP seed downgrade a terminal status from the socket", async () => {
    // Deferred fetch so the HTTP seed resolves only AFTER the socket has
    // delivered a terminal status — the race that regressed the run to `running`.
    let resolveSeed!: (res: {
      ok: boolean;
      json: () => Promise<unknown>;
    }) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
          resolveSeed = resolve;
        }),
      ),
    );

    render(<Probe runId="run-1" />);

    // Socket delivers a terminal status before the HTTP seed resolves.
    act(() => {
      mockSocket.__receive(RUN_COMPLETE, { runId: "run-1", status: "passed" });
    });
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("passed"),
    );

    // The stale HTTP seed resolves with `running` (read before completion).
    resolveSeed({
      ok: true,
      json: async () => ({
        run: { ...baseRun, status: "running" },
        logs: [
          {
            run_id: "run-1",
            seq: 5,
            job: "build",
            step: "s",
            level: "info",
            message: "seeded-after-terminal",
            ts: "2026-07-09T00:00:03.000Z",
          },
        ],
      }),
    });

    // The seed's logs are merged (proving the fetch .then ran), but the terminal
    // status is preserved — the stale `running` does not downgrade `passed`.
    await waitFor(() =>
      expect(screen.getByTestId("logs").textContent).toContain(
        "seeded-after-terminal",
      ),
    );
    expect(screen.getByTestId("status").textContent).toBe("passed");
  });

  it("disconnects the socket on unmount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ run: baseRun, logs: [] }),
      }),
    );
    const { unmount } = render(<Probe runId="run-1" />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("running"),
    );
    unmount();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it("returns an empty state and does not connect when runId is null", () => {
    render(<Probe runId={null} />);
    expect(screen.getByTestId("status").textContent).toBe("none");
    expect(screen.getByTestId("run").textContent).toBe("none");
    expect(mockedIo).not.toHaveBeenCalled();
  });
});
