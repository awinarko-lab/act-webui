import { InvalidInvocationError, type ValidationResult } from "./types";

/**
 * Workflow path allowlist: must live under `.github/workflows/` with a single
 * filename segment (no further slashes, no `..`) and a `.yml`/`.yaml` extension.
 * This rejects path-traversal and out-of-tree identifiers before act is invoked.
 */
const WORKFLOW_RE = /^\.github\/workflows\/[\w.\-]+\.(yml|yaml)$/;

/**
 * Job id / event-name allowlist: alphanumerics, underscore, and hyphen only.
 * Matches GitHub's job-id and event-name character set and blocks any shell
 * metacharacter or path separator.
 */
const IDENT_RE = /^[A-Za-z0-9_\-]+$/;

/** Default event when none is specified; matches act's own default. */
export const DEFAULT_EVENT = "push";

export interface BuildInvocationInput {
  workflow: string;
  job?: string | null;
  event?: string;
  dryRun?: boolean;
}

/**
 * Sanitize identifiers (KTD9) and build the act argument vector.
 *
 * The vector is always returned as an array (never a shell string) so it is
 * passed to `execFile`/`spawn` verbatim — there is no shell to inject into. A
 * path-like or non-allowlisted workflow/job/event throws
 * {@link InvalidInvocationError} before act is ever reached.
 *
 * Vector shape: `<event> -W <workflow> [-j <job>] [--validate] --json`.
 *
 * - The event is act's **positional** argument (default `push`).
 * - `-W` selects the workflow file.
 * - `-j` scopes to a single job (AE11).
 * - `--validate` is a dry-run with no container (AE3/AE4).
 * - `--json` is always present so stdout is structured.
 */
export function buildInvocation(input: BuildInvocationInput): string[] {
  const { workflow, job = null, event = DEFAULT_EVENT, dryRun = false } = input;

  if (!WORKFLOW_RE.test(workflow)) {
    throw new InvalidInvocationError(
      "workflow",
      `workflow must match ${WORKFLOW_RE.source} (got ${JSON.stringify(workflow)})`,
    );
  }
  if (job != null && !IDENT_RE.test(job)) {
    throw new InvalidInvocationError(
      "job",
      `job must match ${IDENT_RE.source} (got ${JSON.stringify(job)})`,
    );
  }
  if (!IDENT_RE.test(event)) {
    throw new InvalidInvocationError(
      "event",
      `event must match ${IDENT_RE.source} (got ${JSON.stringify(event)})`,
    );
  }

  const args: string[] = [event, "-W", workflow];
  if (job) args.push("-j", job);
  if (dryRun) args.push("--validate");
  args.push("--json");
  return args;
}

/**
 * Map an `act --validate` outcome to a validation result.
 *
 * `act --validate` writes its diagnostics (including the YAML parse error) to
 * **stderr** and exits 0 on success / non-zero on failure. The reason is the
 * first line that reads like a validation error; if none is found, the first
 * captured line is used, falling back to the exit code itself.
 *
 * This is a pure function so AE3/AE4 can be unit-tested without running act.
 */
export function interpretValidation(
  exitCode: number | null,
  stderrLines: readonly string[],
  stdoutLines: readonly string[] = [],
): ValidationResult {
  if (exitCode === 0) {
    return { valid: true, exitCode };
  }
  const all = [...stderrLines, ...stdoutLines]
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const reason =
    all.find((l) => /not valid|invalid|error/i.test(l)) ??
    all[0] ??
    `act --validate exited with code ${exitCode}`;
  return { valid: false, reason, exitCode };
}
