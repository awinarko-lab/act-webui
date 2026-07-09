import { getDb } from "./db";
import { RunsRepo } from "./db/runs-repo";
import { RunSupervisor } from "./runner/run-supervisor";

let _supervisor: RunSupervisor | null = null;

/**
 * Process-wide supervisor singleton. Lazily constructed so the SQLite DB and
 * the act spawner are only initialized on first use (e.g. not during a
 * typecheck or a health probe). U6 (Socket.io) imports this same singleton to
 * subscribe to its `events`, so there is exactly one supervisor per process and
 * every run — whether started by the API or observed by the realtime layer —
 * flows through it.
 */
export function getSupervisor(): RunSupervisor {
  if (!_supervisor) {
    _supervisor = new RunSupervisor(new RunsRepo(getDb()));
  }
  return _supervisor;
}

/**
 * A repo for read-only access (history, detail). Wraps the same process-wide
 * SQLite connection as the supervisor, so reads are always consistent with the
 * data the supervisor persists. Cheap to construct (a thin wrapper).
 */
export function getRunsRepo(): RunsRepo {
  return new RunsRepo(getDb());
}
