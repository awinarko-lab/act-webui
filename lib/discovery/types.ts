export interface DiscoveredStep {
  name: string | null;
  uses?: string;
  run?: string;
}

export interface DiscoveredJob {
  id: string;
  name: string | null;
  needs: string[];
  steps: DiscoveredStep[];
}

export interface DiscoveredWorkflow {
  /** Repo-relative path, e.g. ".github/workflows/ci.yml". Used as the `-W` target. */
  path: string;
  /** Display name — the workflow `name:`, else the file stem. */
  name: string;
  /** Trigger event names, e.g. ["push", "pull_request"]. */
  events: string[];
  jobs: DiscoveredJob[];
}

export interface DiscoveryError {
  path: string;
  message: string;
}

export interface DiscoveryResult {
  workflows: DiscoveredWorkflow[];
  errors: DiscoveryError[];
}
