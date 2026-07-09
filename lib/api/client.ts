/**
 * Typed browser client for the act Web UI HTTP API.
 *
 * All requests use relative URLs and same-origin `fetch`, so the dashboard's
 * {@link assertSameOrigin} guard (KTD9) accepts them. Non-2xx responses throw an
 * {@link ApiError} carrying the parsed body and status, so callers can branch on
 * e.g. a 503 pre-flight failure (R24/R25) without parsing strings.
 *
 * Domain types are re-exported here so UI components import from a single module.
 */

import type { EnvironmentInfo } from "@/lib/env/act-detect";
import type {
  DiscoveryError,
  DiscoveredWorkflow,
} from "@/lib/discovery/types";
import type {
  RunLogLine,
  RunRecord,
  RunWithLogs,
} from "@/lib/db/types";

export type {
  DiscoveryError,
  DiscoveredWorkflow,
  EnvironmentInfo,
  RunLogLine,
  RunRecord,
  RunWithLogs,
};

/** Input for `POST /api/runs` — mirrors the route's accepted body shape. */
export interface CreateRunInput {
  /** Workflow file path, e.g. ".github/workflows/ci.yml". */
  workflow: string;
  /** Job id to scope the run to a single job, or null for all jobs. */
  job?: string | null;
  /** Trigger event context, e.g. "push". */
  event?: string;
  /** Validate the workflow without launching a container (--validate). */
  dryRun?: boolean;
}

/** Shape returned by `GET /api/workflows`. */
export interface WorkflowsResponse {
  workflows: DiscoveredWorkflow[];
  errors: DiscoveryError[];
}

/** Shape returned by `GET /api/runs`. */
export interface RunsResponse {
  runs: RunRecord[];
}

/** Shape returned by `POST /api/runs` and `POST /api/runs/[id]/rerun`. */
export interface RunResponse {
  run: RunRecord;
}

/** Shape returned by `POST /api/runs/[id]/cancel`. */
export interface CancelResponse {
  cancelled: boolean;
}

/**
 * Error thrown for any non-2xx API response. `body` is the parsed JSON (or null
 * when the body was empty / unparseable) so callers can read an `environment`
 * field off a 503, an `error` message, etc.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const JSON_HEADERS: HeadersInit = { "Content-Type": "application/json" };

/**
 * Core request helper. Parses JSON when present and converts non-2xx into an
 * {@link ApiError}, preferring a top-level `error` string from the body when the
 * server provides one (all error routes in this app do).
 */
async function request<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });

  const text = await res.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      // Leave data null; the raw text still informs the message below.
    }
  }

  if (!res.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `request to ${url} failed (${res.status})`;
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

/** `GET /api/workflows` — discovered workflows + per-file parse errors. */
export function getWorkflows(): Promise<WorkflowsResponse> {
  return request<WorkflowsResponse>("/api/workflows");
}

/** `POST /api/runs` — start a supervised run (R5/R7/R11, AE1). */
export function createRun(input: CreateRunInput): Promise<RunResponse> {
  return request<RunResponse>("/api/runs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** `GET /api/runs` — run history, most recent first (R10/R16). */
export function listRuns(): Promise<RunsResponse> {
  return request<RunsResponse>("/api/runs");
}

/** `GET /api/runs/[id]` — run metadata plus the full persisted log (R17). */
export function getRunWithLogs(id: string): Promise<RunWithLogs> {
  return request<RunWithLogs>(`/api/runs/${encodeURIComponent(id)}`);
}

/** `POST /api/runs/[id]/cancel` — cancel a running run (R9). */
export function cancelRun(id: string): Promise<CancelResponse> {
  return request<CancelResponse>(
    `/api/runs/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  );
}

/** `POST /api/runs/[id]/rerun` — start a new run with the original's params (AE9). */
export function rerunRun(id: string): Promise<RunResponse> {
  return request<RunResponse>(
    `/api/runs/${encodeURIComponent(id)}/rerun`,
    { method: "POST" },
  );
}

/** `GET /api/health` — act + container-runtime availability (R24/R25). */
export function getHealth(): Promise<EnvironmentInfo> {
  return request<EnvironmentInfo>("/api/health");
}
