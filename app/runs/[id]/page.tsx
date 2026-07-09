"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeftIcon, BanIcon, LoaderIcon, RotateCwIcon } from "lucide-react";

import { LogViewer } from "@/components/log-viewer";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ApiError, cancelRun, rerunRun } from "@/lib/api/client";
import { useRunStream } from "@/lib/realtime/use-run-stream";

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { run, logs, status } = useRunStream(id);

  const [canceling, setCanceling] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleCancel = async () => {
    if (!id) return;
    setActionError(null);
    setCanceling(true);
    try {
      await cancelRun(id);
    } catch (e) {
      setActionError(
        e instanceof ApiError
          ? e.status === 409
            ? "Run is no longer running."
            : e.message
          : "Failed to cancel run",
      );
    } finally {
      setCanceling(false);
    }
  };

  const handleRerun = async () => {
    if (!id) return;
    setActionError(null);
    setRerunning(true);
    try {
      const { run: newRun } = await rerunRun(id);
      router.push(`/runs/${newRun.id}`);
    } catch (e) {
      setRerunning(false);
      setActionError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to start re-run",
      );
    }
  };

  const isRunning = status === "running";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/")}
        className="mb-4"
      >
        <ArrowLeftIcon />
        Back
      </Button>

      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-xl font-semibold tracking-tight">
              Run
            </h1>
            {status && <StatusBadge status={status} />}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {run ? `${run.workflow}` : id ? `run ${id}` : ""}
            {run?.job ? ` · job: ${run.job}` : ""}
            {run?.event ? ` · event: ${run.event}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isRunning && (
            <Button
              variant="destructive"
              onClick={() => void handleCancel()}
              disabled={canceling}
              data-testid="cancel-button"
            >
              {canceling ? <LoaderIcon className="animate-spin" /> : <BanIcon />}
              {canceling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => void handleRerun()}
            disabled={rerunning || isRunning}
            data-testid="rerun-button"
          >
            {rerunning ? <LoaderIcon className="animate-spin" /> : <RotateCwIcon />}
            Re-run
          </Button>
        </div>
      </header>

      {actionError && (
        <div
          data-testid="action-error"
          className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {actionError}
        </div>
      )}

      <Separator className="mb-4" />

      <Card>
        <div className="px-(--card-spacing) pb-2 pt-1">
          <h2 className="mb-2 font-heading text-sm font-medium text-muted-foreground">
            Logs
            {logs.length > 0 && (
              <span className="ml-2 text-xs">
                {logs.length.toLocaleString()} line
                {logs.length === 1 ? "" : "s"}
              </span>
            )}
          </h2>
          <div className="h-[60vh]">
            <LogViewer logs={logs} />
          </div>
        </div>
      </Card>
    </div>
  );
}
