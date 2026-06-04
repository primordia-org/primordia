---
paths:
  - "scripts/**"
---

## File Map: scripts/

```
scripts/
├── reverse-proxy.ts              ← HTTP reverse proxy for blue/green production and preview servers; watches git config; owns prod spawn/log SSE endpoints; routes /preview/{branchName}
├── assign-branch-ports.sh        ← Idempotent migration script: assigns ephemeral branch ports in git config; main gets 3001, others 3002+
├── rollback.ts                   ← Standalone emergency rollback CLI for when the app/admin UI is unavailable
├── install.sh                    ← Primordia setup/deploy script; idempotent; installs proxy/systemd service and production app
├── claude-worker.ts              ← Detached Claude Code worker process; configures gateway/API/subscription auth and streams structured progress
├── pi-worker.ts                  ← Detached pi coding agent worker process; installs/loads edb-todo tools and streams structured progress
├── codex-worker.ts               ← Detached OpenAI Codex CLI worker process; configures gateway/API-key/ChatGPT auth and streams JSONL progress
├── claude-auth-pty.py            ← PTY wrapper used by lib/claude-temp-auth.ts to drive `claude auth login`
├── set-preview-url.ts            ← Evolve-agent helper invoked by `bun run set-preview-url /route`; emits structured preview_path session event
├── regenerate-model-registry.ts  ← Rewrites lib/models.generated.json from the pi ModelRegistry and Primordia model overlays
├── export-branch-graph-ascii.ts  ← CLI exporter for the branch graph layout in ASCII text
├── export-branch-graph-unicode.ts ← CLI exporter for the branch graph layout with Unicode box drawing
├── export-branch-parentage-mermaid.ts ← CLI exporter for branch parentage as Mermaid graph syntax
├── git-hooks/reference-transaction ← Git hook helper for branch/ref transaction tracking
└── test-hmr-proxy.ts             ← Integration tests for reverse proxy WebSocket/HMR tunnel
```
