"use client";

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DiscoveryError, DiscoveredWorkflow } from "@/lib/api/client";

export interface WorkflowListProps {
  workflows: DiscoveredWorkflow[];
  /** Per-file parse errors surfaced from discovery (AE2). */
  errors?: DiscoveryError[];
  /** The currently selected workflow path, or null. */
  selectedPath?: string | null;
  /** Called with a workflow's `path` when it is clicked. */
  onSelect: (path: string) => void;
  /** Re-runs discovery (R4/AE12). */
  onRefresh: () => void;
  /** True while a fetch is in flight. */
  loading?: boolean;
}

export function WorkflowList({
  workflows,
  errors = [],
  selectedPath,
  onSelect,
  onRefresh,
  loading = false,
}: WorkflowListProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="workflow-list">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-base font-medium">Workflows</h2>
          <p className="text-xs text-muted-foreground">
            Discovered from <code>.github/workflows</code>.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          data-testid="workflow-refresh"
        >
          <RefreshCwIcon className={cn(loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {errors.length > 0 && (
        <div
          data-testid="workflow-errors"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
            <TriangleAlertIcon />
            {errors.length} file{errors.length === 1 ? "" : "s"} failed to parse
          </div>
          <ul className="space-y-1">
            {errors.map((error) => (
              <li key={error.path} className="text-amber-800 dark:text-amber-200">
                <code className="font-mono">{error.path}</code>
                <span className="text-amber-700/80 dark:text-amber-300/80">
                  {" "}
                  — {error.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {workflows.length === 0 ? (
        <div
          data-testid="workflow-empty"
          className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 p-8 text-center"
        >
          <p className="font-medium">No workflows found</p>
          <p className="text-sm text-muted-foreground">
            Add a workflow file under <code>.github/workflows</code> and refresh.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {workflows.map((workflow) => {
            const isSelected = workflow.path === selectedPath;
            return (
              <li key={workflow.path}>
                <Card
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={() => onSelect(workflow.path)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(workflow.path);
                    }
                  }}
                  data-testid={`workflow-item-${workflow.path}`}
                  className={cn(
                    "cursor-pointer px-3 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                    isSelected && "bg-muted ring-1 ring-ring/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{workflow.name}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {workflow.path}
                      </div>
                    </div>
                    {isSelected && (
                      <Badge variant="secondary" className="shrink-0">
                        Selected
                      </Badge>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {workflow.events.length > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="font-medium uppercase tracking-wide text-muted-foreground/80">
                          events
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {workflow.events.map((event) => (
                            <Badge
                              key={event}
                              variant="outline"
                              className="font-mono"
                            >
                              {event}
                            </Badge>
                          ))}
                        </span>
                      </div>
                    )}
                    {workflow.jobs.length > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="font-medium uppercase tracking-wide text-muted-foreground/80">
                          jobs
                        </span>
                        <span className="font-mono">
                          {workflow.jobs.map((job) => job.id).join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
