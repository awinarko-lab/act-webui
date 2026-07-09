"use client";

import { useEffect, useState } from "react";
import { LoaderIcon, RefreshCwIcon } from "lucide-react";

import { RunHistoryList } from "@/components/run-history-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listRuns, type RunRecord } from "@/lib/api/client";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the Refresh / retry buttons to re-trigger the fetch effect.
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch run history on mount and on each refresh. State is only set from
  // within the promise callbacks (not synchronously in the effect body), and
  // `active` discards late results from a superseded refresh — mirroring the
  // home page's discovery effect.
  useEffect(() => {
    let active = true;
    listRuns()
      .then((result) => {
        if (!active) return;
        setRuns(result.runs);
        setError(null);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load runs");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const refresh = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Run history
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse past runs and open one for its full logs.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
          data-testid="runs-refresh"
        >
          <RefreshCwIcon className={cn(loading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {error && runs.length === 0 ? (
        <div
          data-testid="runs-error"
          className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={loading}
              data-testid="runs-retry"
            >
              <RefreshCwIcon className={cn(loading && "animate-spin")} />
              Try again
            </Button>
          </div>
        </div>
      ) : loading && runs.length === 0 ? (
        <div
          data-testid="runs-loading"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderIcon className="animate-spin" />
          Loading runs…
        </div>
      ) : (
        <RunHistoryList runs={runs} />
      )}
    </div>
  );
}
