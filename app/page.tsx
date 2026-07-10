"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlertIcon, LoaderIcon } from "lucide-react";

import { RunTriggerPanel, type RunPayload } from "@/components/run-trigger-panel";
import { WorkflowList } from "@/components/workflow-list";
import {
  createRun,
  getHealth,
  getWorkflows,
  type DiscoveryError,
  type DiscoveredWorkflow,
  type EnvironmentInfo,
} from "@/lib/api/client";

export default function HomePage() {
  const router = useRouter();

  const [workflows, setWorkflows] = useState<DiscoveredWorkflow[]>([]);
  const [errors, setErrors] = useState<DiscoveryError[]>([]);
  const [health, setHealth] = useState<EnvironmentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  // Bumped by the Refresh button to re-trigger the discovery effect (R4/AE12).
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch workflows + best-effort health on mount and on each refresh. State is
  // only ever set from within the promise callbacks (not synchronously in the
  // effect body), mirroring `use-run-stream.ts` and keeping the
  // react-hooks/set-state-in-effect rule happy. `active` discards late results
  // from a superseded refresh.
  useEffect(() => {
    let active = true;
    getWorkflows()
      .then((result) => {
        if (!active) return;
        setWorkflows(result.workflows);
        setErrors(result.errors);
      })
      .catch((e) => {
        if (!active) return;
        setLoadError(
          e instanceof Error ? e.message : "Failed to load workflows",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // Health is best-effort: a probe failure only suppresses the banner (R24/R25).
    getHealth()
      .then((h) => {
        if (active) setHealth(h);
      })
      .catch(() => {
        if (active) setHealth(null);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const selected =
    workflows.find((w) => w.path === selectedPath) ?? workflows[0] ?? null;

  const handleRun = async (payload: RunPayload) => {
    setTriggerError(null);
    setSubmitting(true);
    try {
      const { run } = await createRun(payload);
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setSubmitting(false);
      setTriggerError(
        e instanceof Error ? e.message : "Failed to start run",
      );
    }
  };

  const actMissing = health != null && !health.act.installed;
  const containerMissing = health != null && !health.container.available;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Run a workflow
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Discover workflows, configure a run, and watch the logs live.
        </p>
      </header>

      {(actMissing || containerMissing) && (
        <div
          data-testid="health-warning"
          className="mb-6 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <TriangleAlertIcon className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-amber-800 dark:text-amber-200">
            <p className="font-medium">
              Your environment may not be ready to run workflows.
            </p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {actMissing && <li>act is not installed or not on PATH.</li>}
              {containerMissing && (
                <li>No container runtime detected — install Docker or Podman.</li>
              )}
            </ul>
            <p className="mt-1 text-amber-700/80 dark:text-amber-300/80">
              Triggering a run will fail fast with a diagnostic until resolved.
            </p>
          </div>
        </div>
      )}

      {loadError && (
        <div
          data-testid="load-error"
          className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {loadError}
        </div>
      )}

      {loading && workflows.length === 0 ? (
        <div
          data-testid="loading"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderIcon className="animate-spin" />
          Discovering workflows…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <WorkflowList
            workflows={workflows}
            errors={errors}
            selectedPath={selected?.path ?? null}
            onSelect={setSelectedPath}
            onRefresh={() => {
              setLoading(true);
              setLoadError(null);
              setRefreshKey((k) => k + 1);
            }}
            loading={loading}
          />
          <RunTriggerPanel
            workflow={selected}
            submitting={submitting}
            error={triggerError}
            onRun={(payload) => void handleRun(payload)}
          />
        </div>
      )}
    </div>
  );
}
