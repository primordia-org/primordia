# Document and implement scheduled task offloading

Added a design note in `docs/scheduled-task-offloading-ideas.md` that inventories Primordia's scheduled jobs and compares daemon-based CLI jobs, systemd timers, a SQLite-backed job queue, proxy-embedded migration bridges, external schedulers, and a future Core supervisor.

Implemented the first Option A + D bridge: scheduled jobs now run through the Primordia Core jobs boundary in `lib/scheduled-jobs.ts`, with individual job modules organized under `lib/jobs/`. The reverse proxy calls that boundary instead of individual scheduler internals, and `bun run primordia jobs run` can run the same scheduler as a dedicated daemon. A repo/instance lock prevents duplicate schedulers.

Added CLI support for immediate job runs and interval configuration so future settings UI can read/write schedules:

- `bun run primordia jobs run`
- `bun run primordia jobs run-one <job>`
- `bun run primordia jobs schedule list|get|set`
