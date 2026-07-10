import { readFileSync, readdirSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { load } from "js-yaml";
import type {
  DiscoveredJob,
  DiscoveredWorkflow,
  DiscoveryResult,
} from "./types";

const WORKFLOWS_SUBDIR = join(".github", "workflows");

/** Trigger events from a workflow `on:` field — handles string, array, and map. */
export function parseEvents(rawOn: unknown): string[] {
  if (rawOn == null) return [];
  if (typeof rawOn === "string") return [rawOn];
  if (Array.isArray(rawOn)) return rawOn.filter((e): e is string => typeof e === "string");
  if (typeof rawOn === "object") return Object.keys(rawOn as Record<string, unknown>);
  return [];
}

/** Job `needs:` — accepts "a, b" or ["a", "b"]. */
export function parseNeeds(needs: unknown): string[] {
  if (typeof needs === "string") {
    return needs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(needs)) return needs.filter((n): n is string => typeof n === "string");
  return [];
}

function fileStem(filePath: string): string {
  return basename(filePath).replace(/\.(yml|yaml)$/i, "");
}

function parseWorkflow(
  filePath: string,
  doc: Record<string, unknown>,
): DiscoveredWorkflow {
  // Guard against YAML 1.1 schemas that coerce the `on:` key to boolean true
  // (js-yaml 5 does not, but be defensive). A boolean-true key is stored under
  // the string "true" in JS objects, so index by string.
  const rawOn = doc.on ?? doc["true"];
  const rawJobs = (doc.jobs ?? {}) as Record<string, unknown>;

  const jobs: DiscoveredJob[] = Object.entries(rawJobs).map(([id, job]) => {
    const j = (job ?? {}) as Record<string, unknown>;
    const steps = Array.isArray(j.steps) ? j.steps : [];
    return {
      id,
      name: typeof j.name === "string" && j.name.trim() ? j.name : null,
      needs: parseNeeds(j.needs),
      steps: steps.map((s) => {
        const step = (s ?? {}) as Record<string, unknown>;
        return {
          name: typeof step.name === "string" ? step.name : null,
          uses: typeof step.uses === "string" ? step.uses : undefined,
          run: typeof step.run === "string" ? step.run : undefined,
        };
      }),
    };
  });

  const name =
    typeof doc.name === "string" && doc.name.trim() ? doc.name : fileStem(filePath);

  return { path: filePath, name, events: parseEvents(rawOn), jobs };
}

/**
 * Discover workflows under `<repoRoot>/.github/workflows`. A pure function over
 * the filesystem — re-invoking it picks up new/edited files with no state
 * (R4). A malformed file is reported per-file and does not abort the rest (R3).
 */
export function discoverWorkflows(
  repoRoot: string = process.env.ACT_REPO_PATH || process.cwd(),
): DiscoveryResult {
  const dir = join(repoRoot, WORKFLOWS_SUBDIR);
  const workflows: DiscoveredWorkflow[] = [];
  const errors: DiscoveryResult["errors"] = [];

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => /\.(yml|yaml)$/i.test(f))
      .sort();
  } catch {
    // Missing or unreadable directory -> nothing to discover, not a crash.
    return { workflows, errors };
  }

  for (const file of files) {
    const fullPath = join(dir, file);
    const relPath = relative(repoRoot, fullPath);
    try {
      const content = readFileSync(fullPath, "utf-8");
      const doc = load(content);
      if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
        errors.push({ path: relPath, message: "workflow is not a YAML mapping" });
        continue;
      }
      // The guard above proves `doc` is a non-null, non-array object; assert the
      // index signature the parser expects.
      workflows.push(parseWorkflow(relPath, doc as Record<string, unknown>));
    } catch (e) {
      errors.push({ path: relPath, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return { workflows, errors };
}
