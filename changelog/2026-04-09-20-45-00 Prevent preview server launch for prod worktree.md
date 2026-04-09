# Prevent preview server launch for prod worktree

## What changed

Added a guard in `handlePreviewRequest` (`scripts/reverse-proxy.ts`) that refuses to spawn a preview dev server when the session's worktree port matches the current upstream production port.

## Why

When a session branch is accepted and becomes the production branch, its entry in `sessionWorktreeCache` remains valid. If someone then navigated to `/preview/{sessionId}`, the proxy would call `startPreviewServer`, which calls `killPortOwner` to clear the port — killing the running production server — then spawns `bun run dev` in the production worktree, taking prod down.

Example from the logs that triggered this fix:

```
[proxy] starting production server (admin-logs-reverse-proxy-integration) on :3049
[proxy] starting preview server for session admin-logs-reverse-proxy-integration on :3049
[proxy] sent SIGTERM to 2 process(es) on :3049   ← prod server killed
[proxy] stopping preview server for session admin-logs-reverse-proxy-integration
```

The fix checks `info.port === upstreamPort` before spawning. If they match, the request is rejected with HTTP 409 and a plain-text message explaining that the session branch is now the production server.
