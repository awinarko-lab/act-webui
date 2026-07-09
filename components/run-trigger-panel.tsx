"use client";

import { useState } from "react";
import { PlayIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DiscoveredWorkflow } from "@/lib/api/client";

/** Payload emitted when the user starts a run. */
export interface RunPayload {
  /** Workflow file path targeted by the run. */
  workflow: string;
  /** Job id to scope to a single job, or null for all jobs (R11/AE11). */
  job: string | null;
  /** Trigger event context, e.g. "push". */
  event: string;
  /** Validate without launching a container (--validate, R6/AE3). */
  dryRun: boolean;
}

export interface RunTriggerPanelProps {
  /** The currently selected workflow, or null until one is chosen. */
  workflow: DiscoveredWorkflow | null;
  /** True while a run is being created (disables the Run button). */
  submitting?: boolean;
  /** Error message from the last trigger attempt, if any. */
  error?: string | null;
  /** Called with the configured run payload when the user clicks Run (R5/R7). */
  onRun: (payload: RunPayload) => void;
}

export function RunTriggerPanel({
  workflow,
  submitting = false,
  error = null,
  onRun,
}: RunTriggerPanelProps) {
  const [job, setJob] = useState<string>("");
  const [event, setEvent] = useState<string>(() => workflow?.events[0] ?? "");
  const [dryRun, setDryRun] = useState(false);
  const [prevPath, setPrevPath] = useState<string | null>(workflow?.path ?? null);

  // Reset selections when the selected workflow changes, so stale job/event
  // choices from a previous workflow never leak into a new run. Render-phase
  // adjustment avoids an extra committed render (see React docs on adjusting
  // state when a prop changes).
  const currentPath = workflow?.path ?? null;
  if (currentPath !== prevPath) {
    setPrevPath(currentPath);
    setJob("");
    setEvent(workflow?.events[0] ?? "");
    setDryRun(false);
  }

  if (!workflow) {
    return (
      <Card className="px-4 py-6" data-testid="trigger-empty">
        <div className="text-center text-sm text-muted-foreground">
          Select a workflow to configure a run.
        </div>
      </Card>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRun({
      workflow: workflow.path,
      job: job === "" ? null : job,
      event,
      dryRun,
    });
  };

  return (
    <Card>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 px-(--card-spacing) pb-2"
        data-testid="trigger-form"
      >
        <div>
          <h2 className="font-heading text-base font-medium">Configure run</h2>
          <p className="text-xs text-muted-foreground">
            <code className="font-mono">{workflow.path}</code>
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Job</span>
            <select
              value={job}
              onChange={(e) => setJob(e.target.value)}
              data-testid="job-select"
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">All jobs</option>
              {workflow.jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.id}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Event</span>
            <select
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              data-testid="event-select"
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {workflow.events.length === 0 && <option value="">(none)</option>}
              {workflow.events.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            data-testid="dry-run-checkbox"
            className="size-4 rounded border-input"
          />
          <span>Dry run (validate without running)</span>
        </label>

        {error && (
          <div
            data-testid="trigger-error"
            className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        )}

        <div>
          <Button
            type="submit"
            disabled={submitting}
            data-testid="run-button"
          >
            <PlayIcon />
            {submitting ? "Starting…" : "Run"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
