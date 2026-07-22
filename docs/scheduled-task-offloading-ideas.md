# Offloading Scheduled Tasks From Next.js

Primordia's scheduled work should be part of Primordia Core, not a side effect of booting the Next.js app. This note brainstorms ways to move those jobs out of the web process while keeping the current UI/API behavior intact.

## Current Situation

Scheduled jobs are grouped by `lib/scheduled-jobs.ts` and are currently started by the reverse proxy singleton. `instrumentation.ts` no longer starts them; it only reconnects thread workers after a Next.js server restart.

Current jobs:

- Update-source fetches (`lib/update-source-scheduler.ts`): periodically fetch configured upstream Primordia sources and send update notifications.
- Dependency audits (`lib/dependency-audit-scheduler.ts`): daily `bun audit` for high/critical vulnerabilities and security notifications.
- Leak diagnostics (`lib/leak-diagnostics-scheduler.ts`): periodic CPU/memory sampling, diagnostics capture, and server-health notifications.
- Disk cleanup (`lib/disk-space-management.ts`): threshold-based deletion of old non-production worktrees with session-log archiving.

This is already better than starting timers inside Next.js, but it still ties background work to the proxy process and in-process `setInterval` loops.

## Goals

1. Make scheduled jobs a Primordia Core capability, callable without Next.js.
2. Keep web pages as clients of shared modules rather than owners of background work.
3. Make jobs observable and debuggable from the CLI and admin UI.
4. Avoid duplicate job execution when multiple app/proxy processes exist.
5. Keep deployment simple for single-VM exe.dev installs.

## Option A: `primordia jobs run` Long-Lived Daemon

Add a CLI command that starts all scheduled loops:

```bash
bun run primordia jobs run
bun run primordia jobs status --json
bun run primordia jobs run-one dependency-audit
bun run primordia jobs run-one update-sources
```

The systemd unit would run a dedicated `primordia-jobs` service next to `primordia-proxy`.

Pros:

- Clear separation from Next.js and the reverse proxy.
- Fits the ongoing CLI/Core extraction direction.
- Easy to run locally, in tests, and on non-Next frontends.
- Keeps all existing TypeScript job code reusable.

Cons:

- Needs service installation/migration work.
- Needs a locking story so a manually-started daemon and systemd daemon do not both run jobs.

This is the most direct next step.

## Option B: Systemd Timers Per Job

Replace in-process intervals with one-shot CLI commands triggered by systemd timers:

```bash
primordia jobs run-one update-sources
primordia jobs run-one dependency-audit
primordia jobs run-one leak-diagnostics
primordia jobs run-one disk-cleanup
```

Pros:

- No always-on scheduler process.
- systemd handles missed runs, backoff, logs, and process isolation.
- Each job has a clear timeout and restart boundary.

Cons:

- More install-time unit files.
- Less portable to non-systemd environments.
- Leak diagnostics currently wants frequent sampling; one-shot timers may be too coarse unless sampling state is persisted.

This is attractive for exe.dev production, but less ideal as the only cross-platform Core story.

## Option C: SQLite-Backed Job Queue + Worker

Create a small `jobs` table in Primordia's SQLite DB. A scheduler enqueues due jobs; workers claim rows with leases and write attempts/results.

Pros:

- Durable observability: admin UI and CLI can show last run, next due, output, and failures.
- Natural locking and retry semantics.
- Supports future user-triggered background jobs, not only cron-like tasks.

Cons:

- More schema and operational complexity.
- Requires careful DB hotswap behavior for preview worktrees.
- Might be overkill before Primordia Core has more background work.

This is a good medium-term foundation if Primordia needs job history, retries, or multiple worker types.

## Option D: Reverse Proxy Keeps Timers, But Through Core Commands

Keep the proxy as the single always-on process for now, but make it spawn or call `primordia jobs run` instead of importing `lib/scheduled-jobs.ts` directly.

Pros:

- Small migration from today's architecture.
- Preserves the single-service deployment shape.
- Begins enforcing the boundary: proxy orchestrates, Core owns jobs.

Cons:

- Scheduled work remains lifecycle-coupled to the proxy.
- Harder to reuse in terminal-only or non-proxy deployments.
- Still risks proxy reliability being affected by job bugs unless subprocess isolation is used.

This is a pragmatic bridge, not the end state.

## Option E: External Cron / Hosted Scheduler Calls Local API

Expose authenticated local-only endpoints or CLI commands and let cron, GitHub Actions, or a hosted scheduler call them.

Pros:

- Minimal resident code.
- Easy to integrate with managed environments.
- Each environment can choose its scheduler.

Cons:

- Primordia becomes harder to install as a self-contained appliance.
- Requires token management and network exposure choices.
- Hosted schedulers are a poor fit for local-only VM maintenance tasks like disk cleanup.

This is best as an optional adapter, not the default.

## Option F: Supervisor Process Owns Proxy, App, Workers, and Jobs

Make `primordia core run` the one long-lived process. It starts the reverse proxy, watches production/preview servers, reconnects agent workers, and runs scheduled jobs. Next.js becomes only a child app server.

Pros:

- Strongest expression of Primordia Core as the owner of runtime behavior.
- One service can coordinate ports, locks, workers, previews, jobs, logs, and deploys.
- Cleaner eventual path to non-Next frontends.

Cons:

- Larger architectural shift.
- Higher blast radius if the supervisor has bugs.
- Needs careful restart and zero-downtime deploy design.

This could be the north-star runtime, but should come after the CLI job boundary exists.

## Shared Building Blocks Needed

Regardless of option, the scheduled tasks should converge on a small Core API:

```ts
type PrimordiaJobName =
  | "update-sources"
  | "dependency-audit"
  | "leak-diagnostics"
  | "disk-cleanup";

type PrimordiaJob = {
  name: PrimordiaJobName;
  defaultIntervalMs: number;
  runOnce(context: PrimordiaJobContext): Promise<PrimordiaJobResult>;
};
```

Useful supporting pieces:

- A repo-level lock file or SQLite lease to prevent duplicate schedulers.
- `runOnce` functions for every current job, separate from interval setup.
- Structured job result records with start time, end time, status, and summary.
- CLI commands for `jobs list`, `jobs status`, `jobs run`, and `jobs run-one`.
- Admin UI reads job state through shared Core modules/API, not direct timer state.
- Install script can select a scheduler backend: `daemon`, `systemd-timers`, or `proxy-embedded`.

## Recommended Path

1. **Extract job definitions**: split each scheduler into `runOnce` plus interval wrapper. Keep current behavior working.
2. **Add CLI commands**: implement `primordia jobs run-one <name>` and `primordia jobs run` using shared job definitions.
3. **Add a scheduler lock**: use SQLite or a repo lock file so only one daemon runs scheduled jobs per instance.
4. **Move production scheduling to a dedicated service**: install `primordia-jobs.service` on exe.dev while leaving a fallback proxy-embedded mode for simple local dev.
5. **Add observability**: persist last run/failure state and surface it in `primordia jobs status --json` and the relevant admin pages.
6. **Revisit the supervisor north star**: once proxy, servers, workers, and jobs all have CLI/Core boundaries, decide whether a single `primordia core run` supervisor should own them.

The near-term win is Option A with pieces of Option D as a migration bridge: Core owns the job API and CLI, production runs jobs outside Next.js, and the proxy stops importing scheduler internals over time.
