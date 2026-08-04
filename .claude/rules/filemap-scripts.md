---
paths:
  - "scripts/**"
---

## File Map: scripts/

```
scripts/
├── service-supervisor.ts         ← Small systemd-facing monitor that keeps detached reverse proxy and scheduled jobs daemon services alive; SIGHUP checks both, SIGUSR1 restarts proxy, SIGUSR2 restarts jobs
├── reverse-proxy.ts              ← HTTP reverse proxy for blue/green production and preview servers; watches git config; owns prod spawn/log SSE endpoints; routes /preview/{branchName}
├── scheduled-jobs.ts             ← Bundled entrypoint for the supervised Primordia jobs daemon
├── assign-branch-ports.sh        ← Idempotent migration script: assigns ephemeral branch ports in git config; main gets 3001, others 3002+
├── rollback.ts                   ← Standalone emergency rollback CLI for when the app/admin UI is unavailable
├── install.sh                    ← Primordia setup/deploy script; idempotent; installs supervisor/proxy/systemd service and production app
├── primordia.ts                  ← Lightweight Primordia CLI command tree/help/completion entrypoint; lazy-loads runtime handlers for real commands
├── primordia-cli-context.ts      ← Default process-backed CLI context implementation and shared context type for injectable cwd/env/stdin/stdout/stderr
├── primordia-command-handlers.ts ← Runtime handlers for `bun run primordia status`, `thread ...`, and `server ...`; imports heavier thread/process modules only after dispatch; handlers take an injectable CLI context so Core API callers can run them in-process
├── primordia-preset-helpers.ts  ← CLI preset ID/completion helpers, including short built-in IDs and per-user custom preset slugs
├── claude-worker.ts              ← Detached Claude Code worker process; configures gateway/API/subscription auth and streams structured progress
├── pi-worker.ts                  ← Detached pi coding agent worker process; configures gateway/API/subscription auth and streams structured progress
├── codex-worker.ts               ← Detached OpenAI Codex CLI worker process; configures gateway/API-key/ChatGPT auth and streams JSONL progress
├── claude-auth-pty.py            ← PTY wrapper used by lib/claude-temp-auth.ts to drive `claude auth login`
├── progress-monitor.ts           ← Evolve-agent helper invoked by `bun run progress`; appends progress_plan/progress_step events to the session log
├── set-preview-url.ts            ← Evolve-agent helper invoked by `bun run set-preview-url /route`; emits structured preview_path session event
├── regenerate-model-registry.ts  ← Rewrites lib/models.generated.json from the pi ModelRegistry and Primordia model overlays
├── export-branch-graph-ascii.ts  ← CLI exporter for the branch graph layout in ASCII text
├── export-branch-graph-unicode.ts ← CLI exporter for the branch graph layout with Unicode box drawing
├── export-branch-parentage-mermaid.ts ← CLI exporter for branch parentage as Mermaid graph syntax
├── git-hooks/reference-transaction ← Git hook helper for branch/ref transaction tracking
└── test-hmr-proxy.ts             ← Integration tests for reverse proxy WebSocket/HMR tunnel
```
