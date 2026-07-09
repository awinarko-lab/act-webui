"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { RunRecord } from "@/lib/api/client";
import type { RunStatus } from "@/lib/db/types";

export interface RunHistoryListProps {
  /** Runs to render, expected most-recent-first (R10/R16). */
  runs: RunRecord[];
}

type StatusFilter = RunStatus | "all";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * Formats a run duration. In-progress runs have a null `duration_ms`, which we
 * render as an em dash. Sub-second durations keep their millisecond resolution;
 * anything longer collapses to seconds (one decimal) or minutes+seconds.
 */
export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remSeconds}s`;
}

/** Formats an ISO timestamp for display, falling back to the raw string. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function RunHistoryList({ runs }: RunHistoryListProps) {
  const [filter, setFilter] = useState<StatusFilter>("all");

  // Counts per status for the filter chips; computed once over the full list
  // so they stay stable regardless of the active filter.
  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const run of runs) {
      byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
    }
    return byStatus;
  }, [runs]);

  const filtered =
    filter === "all" ? runs : runs.filter((r) => r.status === filter);

  if (runs.length === 0) {
    return (
      <div
        data-testid="run-history-empty"
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 p-8 text-center"
      >
        <p className="font-medium">No runs yet</p>
        <p className="text-sm text-muted-foreground">
          Trigger a workflow from the{" "}
          <Link href="/" className="font-medium underline underline-offset-4">
            home page
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="run-history-list">
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Filter runs by status"
      >
        {FILTERS.map((f) => {
          const active = filter === f.value;
          const count =
            f.value === "all" ? runs.length : (counts[f.value] ?? 0);
          return (
            <Button
              key={f.value}
              variant={active ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f.value)}
              aria-pressed={active}
              data-testid={`filter-${f.value}`}
            >
              {f.label}
              <span className="ml-1 text-xs opacity-70">{count}</span>
            </Button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div
          data-testid="run-history-filter-empty"
          className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground"
        >
          No runs match the selected filter.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((run) => (
            <li key={run.id}>
              <Link
                href={`/runs/${run.id}`}
                data-testid={`run-item-${run.id}`}
                className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Card className="cursor-pointer px-3 transition-colors hover:bg-muted/50">
                  <div className="flex items-center justify-between gap-3 py-0.5">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm font-medium">
                        {run.workflow}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {run.job && (
                          <span className="flex items-center gap-1">
                            <span className="font-medium uppercase tracking-wide text-muted-foreground/80">
                              job
                            </span>
                            <span className="font-mono">{run.job}</span>
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <span className="font-medium uppercase tracking-wide text-muted-foreground/80">
                            event
                          </span>
                          <span className="font-mono">{run.event}</span>
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <StatusBadge status={run.status} />
                      <div className="text-right">
                        <div
                          className="text-xs text-muted-foreground"
                          title={run.started_at}
                        >
                          {formatTimestamp(run.started_at)}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {formatDuration(run.duration_ms)}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
