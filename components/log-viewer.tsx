"use client";

import { useEffect, useMemo, useRef } from "react";

import { cn } from "@/lib/utils";
import type { RunLogLine } from "@/lib/db/types";

/**
 * Cap the number of rendered lines so a very large persisted log (U8 territory)
 * never freezes the page. The newest N lines are shown; older ones are noted.
 * Virtualization is intentionally out of scope for the MVP.
 */
const MAX_RENDERED_LINES = 5000;

interface LogGroup {
  /** Job id, or "" for lines without a job. */
  job: string;
  lines: RunLogLine[];
}

/** Stable group ordering by first appearance, preserving line order within a job. */
function groupByJob(lines: RunLogLine[]): LogGroup[] {
  const groups = new Map<string, RunLogLine[]>();
  const order: string[] = [];
  for (const line of lines) {
    const key = line.job ?? "";
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(line);
  }
  return order.map((job) => ({ job, lines: groups.get(job)! }));
}

/** Tailwind text color per log level (case-insensitive). */
function levelClassName(level: string | null): string {
  const normalized = (level ?? "").toLowerCase();
  switch (normalized) {
    case "error":
    case "fatal":
    case "critical":
      return "text-red-600 dark:text-red-400";
    case "warn":
    case "warning":
      return "text-amber-600 dark:text-amber-400";
    case "debug":
    case "trace":
      return "text-muted-foreground";
    case "info":
      return "text-foreground";
    default:
      return "text-foreground";
  }
}

export function LogViewer({ logs }: { logs: RunLogLine[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { groups, dropped } = useMemo(() => {
    const trimmed =
      logs.length > MAX_RENDERED_LINES
        ? logs.slice(logs.length - MAX_RENDERED_LINES)
        : logs;
    return { groups: groupByJob(trimmed), dropped: logs.length - trimmed.length };
  }, [logs]);

  // Auto-scroll to the bottom whenever the rendered line count grows so a live
  // run stays pinned to the newest output (R8). jsdom exposes scrollHeight as 0,
  // so this is a no-op there but works in a real browser.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [groups, logs.length]);

  if (logs.length === 0) {
    return (
      <div
        data-testid="log-viewer-empty"
        className="flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground"
      >
        No logs yet. Output appears here once the run starts.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      data-testid="log-viewer"
      className="h-full max-h-[70vh] overflow-y-auto rounded-lg bg-zinc-950/95 p-3 font-mono text-xs leading-relaxed text-zinc-100 ring-1 ring-foreground/10 dark:bg-black/40"
    >
      {dropped > 0 && (
        <div className="mb-2 border-b border-zinc-700/60 pb-2 text-amber-300/90">
          Showing the latest {MAX_RENDERED_LINES.toLocaleString()} of{" "}
          {logs.length.toLocaleString()} lines.
        </div>
      )}
      {groups.map((group) => (
        <section
          key={group.job || "__ungrouped__"}
          data-testid={`log-group-${group.job || "ungrouped"}`}
          className="mb-3 last:mb-0"
        >
          <h3 className="mb-1 flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-zinc-400">
            <span className="text-zinc-500">job:</span>
            {group.job || "(ungrouped)"}
          </h3>
          <ul className="space-y-0.5">
            {group.lines.map((line) => (
              <li
                key={`${line.job ?? ""}-${line.seq}-${line.ts}`}
                data-testid="log-line"
                className="flex gap-2"
              >
                {line.step && (
                  <span className="shrink-0 text-zinc-500">[{line.step}]</span>
                )}
                {line.level && (
                  <span className="w-12 shrink-0 uppercase text-zinc-500">
                    {line.level}
                  </span>
                )}
                <span
                  className={cn(
                    "whitespace-pre-wrap break-words",
                    levelClassName(line.level),
                  )}
                >
                  {line.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
