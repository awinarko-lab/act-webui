---
date: 2026-07-09
topic: act-web-ui
---

# Act Web UI — Requirements

## Summary

A local-first web dashboard that wraps the `act` CLI so an internal dev team can discover GitHub Actions workflows, trigger whole-workflow, single-job, or event-simulated runs, watch live per-job step logs, and revisit full run history. It runs on each developer's machine now and stays open to a shared-server + auth deployment later.

---

## Problem Frame

The team iterates on GitHub Actions workflows before pushing them to GitHub. Today that means running `act` in a terminal — a manual, opaque loop with no persistent record. Logs scroll by and are lost when the terminal closes, there is no history of what ran or whether it passed, and re-running a specific job or event means reconstructing a long command line. The cost is slow feedback and repeated effort: a workflow that fails remotely is debugged remotely because the local run that would have caught it was never kept.

Act Web UI replaces that terminal loop with a repeatable GUI. Discovery, triggering, live logs, and history become first-class, shareable artifacts rather than ephemeral terminal sessions.

---

## Actors

- **Developer (primary).** An internal team member running workflows against their local repository checkout.
- **Act Web UI server.** A Next.js custom server hosting both the App Router request handler and the Socket.io log stream. It spawns and supervises `act` subprocesses and persists run history.
- **`act` + container runtime.** `act` executes the workflow inside Docker or Podman. It is an external dependency, not part of this codebase.
- **(Deferred) Additional users.** On a future shared-server deployment behind authentication.

---

## Key Decisions

- **Local-first, auth deferred.** The MVP binds to localhost and ships without authentication. The design avoids hard-coding localhost-only assumptions in request handling so that a shared-server + auth deployment is an additive change rather than a rewrite.
- **Single repository (cwd).** The MVP operates on one repository — the working directory the server started in, or a configured path. There is no multi-repo browsing or management.
- **Live log streaming via Next.js custom server + Socket.io.** The App Router has no native WebSocket support. A custom server hosts both the Next request handler and a Socket.io server, which streams per-job step logs to the browser in real time. This was chosen during brainstorming to satisfy the live-log requirement on the stated stack.
- **Run history retains full logs.** Every run persists its metadata and its complete step-level log output, so any past run can be re-opened and re-read end to end. Storage growth is bounded by a retention policy.
- **Concurrent runs allowed, no cap.** Runs are independent and may overlap; `act` and the container runtime handle the parallelism. There is no serial queue and no hard concurrency cap in the MVP — the host runtime bounds resources.
- **Three low-cost additions beyond the four core features.** Dry-run validation, cancel a running job, and re-run from history are included because each is cheap to build and maintain, and together they make the runner genuinely usable.

---

## Requirements

**Workflow discovery**

- R1. The app discovers workflows by reading the YAML files under `.github/workflows` in the current repository.
- R2. The app lists each workflow with its name, its trigger events, and the jobs it contains, including each job's name and any declared job dependencies.
- R3. Discovery handles malformed or invalid YAML gracefully: the invalid file is surfaced with a clear parse error, valid workflows still list, and the app does not crash.
- R4. Discovery is re-runnable on demand, so newly added or edited workflows appear without a server restart.

**Triggering runs**

- R5. The user can trigger a run of an entire workflow.
- R6. The user can trigger a run scoped to a single job within a workflow.
- R7. The user can choose the event context for a run; at minimum the default `push` event is supported, with basic event selection available.
- R8. A dry-run mode validates a workflow without creating containers or taking side effects, and reports whether the workflow is valid.
- R9. The user can cancel a running run; the `act` subprocess is terminated and the run records a cancelled status.
- R10. The user can re-run any past run from history, which creates a new run with the same workflow, job, and event parameters.
- R11. If `act` or its container runtime is unavailable when a run is triggered, the run fails fast with a diagnostic message rather than hanging.

**Real-time logs**

- R12. While a run executes, its output streams live to the browser without manual refresh.
- R13. Logs are organized per job and per step, not as a single undifferentiated stream.
- R14. The live stream recovers from transient client disconnects: reconnect resumes the stream with no silent loss of log lines.
- R15. Each run's output is also captured server-side, so the complete log survives the run's end and the closing of the browser.

**Run history**

- R16. Every run is persisted with its status (`running`, `passed`, `failed`, `cancelled`), its start and end timestamps, and its duration.
- R17. Each history entry records the trigger parameters: which workflow, which job (if scoped), and which event context was used.
- R18. Each history entry retains the full step-level logs, so any past run can be re-opened and re-read end to end.
- R19. A run's terminal status is derived from the `act` process exit code: exit zero becomes `passed`, non-zero becomes `failed`, and a user-initiated stop becomes `cancelled`.
- R20. History retains the N most recent runs per repo and prunes the oldest beyond that cap (default 50, configurable), bounding storage growth.

**Testing**

- R21. Unit tests cover the core testable logic of every feature and must pass.
- R22. The following are specifically unit-tested: workflow YAML parsing and job/event extraction; run lifecycle and status transitions; construction of the `act` invocation (workflow, job, event, and dry-run selections); parsing and segmentation of `act` output into jobs and steps; run-history persistence and retrieval; and retention pruning logic.
- R23. Every acceptance example below is exercisable end to end for its behavioral feature.

**Cross-cutting**

- R24. The app detects at startup whether `act` is installed and surfaces a clear error if it is missing.
- R25. The app assumes a container runtime (Docker or Podman) is available; its absence is reported as a run failure with guidance.
- R26. The UI is built with Next.js App Router, TypeScript, Tailwind CSS, and shadcn/ui, matching the stated stack.
- R27. The design avoids baking localhost-only assumptions into request handling, so the later shared-server + auth path is additive.

---

## Key Flows

- F1. **Discover workflows.** The developer opens the UI; the server reads `.github/workflows`; workflows, jobs, and events are listed. A refresh re-reads.
  - **Actors:** Developer, Act Web UI server.
  - **Outcome:** The developer sees the current set of workflows.
  - **Covers R1, R2, R4.**
- F2. **Trigger a run.** The developer selects a workflow and optional job, event, and dry-run; the server spawns `act`; a run is created with `running` status; logs begin streaming.
  - **Actors:** Developer, Act Web UI server, `act` + container runtime.
  - **Outcome:** A run begins and its output starts reaching the browser.
  - **Covers R5, R6, R7, R8, R12.**
- F3. **Watch live logs.** The client subscribes to the run's stream over Socket.io; per-job and per-step logs arrive in real time; on completion the status updates to `passed` or `failed`.
  - **Actors:** Developer, Act Web UI server.
  - **Outcome:** The developer observes progress and the final result without leaving the page.
  - **Covers R12, R13, R15, R19.**
- F4. **Cancel a run.** The developer cancels; the server terminates the `act` process; the status becomes `cancelled`; partial logs are retained.
  - **Actors:** Developer, Act Web UI server, `act` + container runtime.
  - **Outcome:** The run stops cleanly and its partial output is preserved.
  - **Covers R9, R18.**
- F5. **Revisit history.** The developer opens history, selects a past run, and views its full logs and metadata; the developer can re-run it.
  - **Actors:** Developer, Act Web UI server.
  - **Outcome:** A past run is inspectable and repeatable.
  - **Covers R16, R17, R18, R10.**

---

## Acceptance Examples

- AE1. **Trigger when `act` is not installed.**
  - **Covers R11, R24.**
  - **Given** `act` is missing from the system.
  - **When** the developer triggers a run.
  - **Then** the run fails immediately with a message identifying the missing dependency, and the UI never hangs waiting for output.
- AE2. **Invalid workflow YAML during discovery.**
  - **Covers R3.**
  - **Given** `.github/workflows` contains one malformed file alongside valid workflows.
  - **When** discovery runs.
  - **Then** the valid workflows list normally, and the malformed file is shown with a parse error pointing at the offending file.
- AE3. **Dry-run on a valid workflow.**
  - **Covers R8.**
  - **Given** a syntactically and structurally valid workflow.
  - **When** the developer triggers a dry-run.
  - **Then** the workflow is reported valid, and no container is created and no side effects occur.
- AE4. **Dry-run on an invalid workflow.**
  - **Covers R8.**
  - **Given** a workflow that references an unknown job dependency or otherwise fails validation.
  - **When** the developer triggers a dry-run.
  - **Then** the workflow is reported invalid with a reason, and no container is created.
- AE5. **Run succeeds.**
  - **Covers R16, R18, R19.**
  - **Given** a workflow whose `act` process exits zero.
  - **When** the run completes.
  - **Then** its status becomes `passed`, its start, end, and duration are recorded, and its full step-level logs are retained in history.
- AE6. **Run fails.**
  - **Covers R16, R18, R19.**
  - **Given** a workflow whose `act` process exits non-zero.
  - **When** the run completes.
  - **Then** its status becomes `failed`, and its full step-level logs are retained in history for diagnosis.
- AE7. **Cancel a run mid-execution.**
  - **Covers R9, R18.**
  - **Given** a run is `running`.
  - **When** the developer cancels it.
  - **Then** the `act` subprocess is terminated, the status becomes `cancelled`, and the logs produced up to that point are retained.
- AE8. **Client reconnects mid-stream.**
  - **Covers R14.**
  - **Given** a run is streaming and the browser disconnects then reconnects.
  - **When** the client resubscribes.
  - **Then** the stream resumes and no log lines are silently lost.
- AE9. **Re-run from history.**
  - **Covers R10.**
  - **Given** a completed run exists in history.
  - **When** the developer re-runs it.
  - **Then** a new run is created with the same workflow, job, and event parameters, and it streams like any fresh run.
- AE10. **History retention prunes old runs.**
  - **Covers R20.**
  - **Given** history exceeds the configured retention policy.
  - **When** pruning runs.
  - **Then** the oldest runs and their logs are removed while recent runs are retained, and storage growth stays bounded.
- AE11. **Single-job trigger runs only that job.**
  - **Covers R6.**
  - **Given** a workflow with multiple jobs.
  - **When** the developer triggers a run scoped to one job.
  - **Then** only the selected job executes, and its logs are attributed to that job.
- AE12. **Refresh picks up a new workflow.**
  - **Covers R4.**
  - **Given** a new workflow file is added to `.github/workflows`.
  - **When** the developer refreshes discovery.
  - **Then** the new workflow appears without a server restart.

---

## Success Criteria

- Every unit test listed in R22 passes, and every acceptance example AE1–AE12 is demonstrable end to end.
- Live logs reach the browser in real time with no manual refresh, and a finished run's complete logs remain viewable afterward.
- A missing `act` or container runtime never leaves the UI hanging; every failure path produces a clear, actionable message.
- A developer with no prior exposure to the tool can discover a workflow, run it, and read its logs without external documentation.

---

## Scope Boundaries

**Deferred for later**

- Authentication and multi-user support for a shared-server deployment.
- Multi-repo management: browsing and running workflows across several repositories.
- An in-app secrets manager. Until then, secrets rely on `act`'s existing mechanisms (`.secrets` file, `--secret`, or environment).
- Rich trigger authoring: a `workflow_dispatch` inputs UI, a matrix picker, and a custom event-payload editor.
- Run queuing, concurrency caps, and resource scheduling.
- Artifact and cache management UI.

**Outside this product's identity**

- Executing on real GitHub-hosted runners or pushing to GitHub to run remote CI. Act Web UI is strictly local `act`.
- Workflow authoring or in-app YAML editing. This product runs workflows; it does not author them.
- Scheduled (cron) triggering of workflows.

---

## Dependencies / Assumptions

- `act` is installed and on `PATH`. Verified present at version 0.2.89; startup detects it.
- A container runtime (Docker or Podman) is installed and running, because `act` depends on it.
- The target repository contains `.github/workflows/*.yml` or `*.yaml` for discovery to return anything.
- The MVP is single-repo: the server runs against the repository in its working directory or a configured path.
- Socket.io over a Next.js custom server is the chosen streaming transport; the App Router alone cannot host WebSockets.
- A persistence store is required for durable run history and full-log retention. The specific store is deferred to planning; the requirement is durability across server restarts and storage bounded by the retention policy.

---

## Outstanding Questions

- The persistence store selection and its schema.
- The exact Socket.io event and message protocol, and the strategy for parsing `act` output into job and step segments.
- Whether discovery leans on `act --list` / `--list-options`, parses the workflow YAML directly, or combines both.
- How secrets are surfaced to runs in the interim before a secrets manager exists.

---

## Sources / Research

- `act` 0.2.89 is installed. Confirmed flags relevant to these requirements: `-j, --job` (run a single job), `-n, --dryrun` (validate without container creation), `-e, --eventpath` (path to an event JSON payload), `-l, --list` and `--list-options` (list workflows and compatible options), `-s, --secret` / `--secret-file`, `--matrix`, and `--input`. This version has no event-name flag; events are simulated via a payload file passed to `--eventpath`, and the default event is `push`.
- The discovery source is `.github/workflows/*.yml|yaml`, the GitHub Actions convention.
- The repository is greenfield: only `README.md` exists, with no scaffold to extend.
