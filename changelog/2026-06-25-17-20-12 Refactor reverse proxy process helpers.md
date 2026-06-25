# Refactor reverse proxy process helpers

The reverse proxy now statically imports shared helpers instead of dynamically resolving helper modules at runtime. Process and git orchestration has been centralized in `lib/process-manager.ts`, including branch-port assignment, detached worktree server starts/stops/restarts, production routing state, and git-config watching. Port-owner cleanup is now internal to the process-manager start/restart flow, so the proxy never clears ports directly.

Primordia runtime path resolution moved into `lib/git-runtime.ts`, so the reverse proxy no longer imports filesystem helpers just to find `PRIMORDIA_ROOT` or watch git config changes.

All internal `/_proxy/*` management routes were removed from the reverse proxy. Callers that previously asked the proxy to start, stop, restart, or stream logs now use `lib/process-manager.ts` directly or the `bun run process` CLI. Production deploys start the new slot with `bun run process <branch> start --prod`, health-check it, and then flip git config for the proxy to route traffic. Preview restarts and accept/reject cleanup stop servers through the process manager instead of HTTP calls to the proxy.

Disk cleanup concerns moved out of the proxy/process-manager split: `lib/disk-space-management.ts` owns disk usage checks and worktree deletion/archive cleanup, while `lib/scheduled-jobs.ts` owns the recurring job timers. The reverse proxy remains the singleton that starts scheduled jobs for now, but only by calling `runScheduledJobs(...)`.

The proxy now owns zero app server child processes: production and preview servers are started as detached worktree processes with logs written to each worktree's `.primordia-next-server.log`. The admin server logs page streams that production worktree log file directly rather than reading a reverse-proxy ring buffer.
