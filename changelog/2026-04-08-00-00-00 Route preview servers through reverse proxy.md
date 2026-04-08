# Route preview servers through reverse proxy

## What changed

Preview dev servers (spawned during evolve sessions) are now routed through the existing reverse proxy instead of being accessed directly by raw port.

### `scripts/reverse-proxy.ts`

- Loads a new `proxy-previews.json` file from the worktrees directory (alongside the existing `proxy-upstream.json`).
- Watches it for changes with `fs.watch()` and a 5 s safety-net poll, same pattern as the main upstream config.
- Added `resolveTargetPort(urlPath)`: requests matching `/preview/{sessionId}` are routed to the corresponding preview server port; all other traffic continues to the main upstream as before.
- Both the HTTP and WebSocket upgrade handlers now call `resolveTargetPort` to pick the destination port.

### `lib/evolve-sessions.ts`

- Added `registerPreviewRoute(sessionId, port)` — writes `sessionId → port` into `proxy-previews.json` so the proxy can route traffic. No-op when `REVERSE_PROXY_PORT` is unset.
- Added `unregisterPreviewRoute(sessionId)` — removes the entry when the preview server stops. Called on dev server `close` in both `startLocalEvolve` and `restartDevServerInWorktree`, and also at the start of a restart before the new process is spawned.
- Preview dev servers are now spawned with `NEXT_BASE_PATH=/preview/{sessionId}` (when `REVERSE_PROXY_PORT` is set) so Next.js serves the app at that sub-path.
- `previewUrl` is now set to `http://{host}:{REVERSE_PROXY_PORT}/preview/{sessionId}` when the proxy is running — users click a clean URL through the proxy, with no raw port exposed.
- Fallback: when `REVERSE_PROXY_PORT` is not set (local dev without a proxy), `NEXT_BASE_PATH` is left unset and `previewUrl` continues to use the direct `http://{host}:{port}` form.

### `proxy-previews.json` format

```json
{
  "abc123def": 3002,
  "xyz789ghi": 3005
}
```

## Why

Previously each preview server was accessed at a raw ephemeral port (`http://host:3002`), which requires that port to be open in any firewall and leaks implementation details. Routing through the reverse proxy at `/preview/{sessionId}` means:

1. Only the proxy port (e.g. 3000) needs to be publicly reachable.
2. Preview URLs are stable-looking paths rather than raw ports.
3. The proxy already handles WebSocket upgrades (required for Next.js HMR), so no extra infrastructure is needed.
