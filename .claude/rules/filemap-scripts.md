---
paths:
  - "scripts/**"
---

## File Map: scripts/

```
scripts/
├── reverse-proxy.ts          ← HTTP reverse proxy for zero-downtime blue/green AND preview servers; listens on REVERSE_PROXY_PORT; reads production branch from git config (primordia.productionBranch); discovers worktrees via $PRIMORDIA_DIR; captures prod server stdout/stderr in a 50 KB ring buffer; exposes POST /_proxy/prod/spawn (SSE) and GET /_proxy/prod/logs (SSE); watches .git/config for instant cutover; routes /preview/{branchName} to session preview servers (no slashes in branch names); installed to ~/primordia-proxy.ts by scripts/install.sh
├── assign-branch-ports.sh    ← Idempotent migration script: assigns ephemeral ports to all local branches in git config (branch.{name}.port); main gets 3001, others get 3002+
├── rollback.ts               ← Standalone CLI rollback script: updates primordia.productionBranch to the previous slot (second entry in primordia.productionHistory) and restarts primordia-proxy; use when the server itself is broken and /api/admin/rollback is unreachable
├── install.sh                ← Primordia setup script; supports two invocation methods; idempotent
├── claude-worker.ts          ← Standalone Claude Code worker process that handles LLM calls via exe.dev gateway
├── pi-worker.ts              ← Standalone pi coding agent worker process; spawned as detached child surviving restarts
├── regenerate-model-registry.ts ← Reads the pi ModelRegistry and rewrites lib/models.generated.json; run with `bun run regenerate:model-registry` after updating @mariozechner/pi-coding-agent
└── test-hmr-proxy.ts         ← Integration tests for reverse proxy WebSocket/HMR tunnel
```
