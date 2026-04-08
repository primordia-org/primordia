# Proxy manages preview server lifecycle

## What changed

Moved all preview server (dev server) spawning, tracking, and teardown from the
Next.js process into the reverse proxy (`scripts/reverse-proxy.ts`).

### Reverse proxy (`scripts/reverse-proxy.ts`)
- Added `PreviewEntry` type tracking process handle, log buffer, activity timestamp,
  status (`starting | running | stopped`), start-waiters, and SSE log subscribers.
- Added `previewProcesses: Map<sessionId, PreviewEntry>` — the authoritative process registry.
- `readAllPorts()` now also builds `sessionWorktreeCache` (sessionId → worktreePath + port)
  by parsing `git worktree list --porcelain`.
- `startPreviewServer(sessionId, info)` — spawns `bun run dev` in the session worktree with
  `NODE_ENV=development`, `PORT`, `NEXT_BASE_PATH=/preview/{sessionId}`, and
  `REVERSE_PROXY_PORT` set. Streams stdout/stderr into a rolling 50 KB log buffer and
  notifies waiters when "Ready" is detected.
- `stopPreviewServer(sessionId)` — kills the process group via negative PID SIGTERM.
- Inactivity timer (every 60 s): stops any preview server idle for 30 minutes.
- Auto-start: when a request arrives for `/preview/{sessionId}` and no server is running,
  the proxy starts one lazily. The incoming request (body buffered) is queued until the
  server is ready (up to 2 minutes), then forwarded — no 502 for the first visitor.
- **Proxy management API** (`/_proxy/preview/:id/...`):
  - `GET /status` → `{ devServerStatus }`
  - `POST /restart` → kill + start
  - `DELETE /` → kill
  - `GET /logs` → SSE stream of log buffer + live lines
- On SIGTERM, all preview servers are stopped before the proxy exits.

### `lib/evolve-sessions.ts`
- Removed `activeDevServerProcesses` Map.
- Removed `inferDevServerStatus()` (was checking lsof; replaced by proxy status API).
- `startLocalEvolve()`: removed Step 6 (dev server spawn). After Claude finishes, the
  session is immediately marked `ready` with `previewUrl` set to the proxy path. The
  proxy starts the dev server lazily on first request.
- `restartDevServerInWorktree()`: replaced the old spawn logic with a thin HTTP call to
  `/_proxy/preview/{sessionId}/restart`.

### `app/api/evolve/stream/route.ts`
- Removed `devServerStatus` from SSE events (proxy owns that now).
- `isTerminal` simplified: `status === 'ready'` is always terminal — no more waiting for
  the dev server to come up before declaring the session done.

### `app/api/evolve/kill-restart/route.ts`
- Replaced `restartDevServerInWorktree` call with `POST /_proxy/preview/{id}/restart`.

### `app/api/evolve/manage/route.ts`
- Replaced `lsof`-based preview server kill with `DELETE /_proxy/preview/{id}` (both
  in the main accept/reject handler and in `retryAcceptAfterFix`).
- The production server kill (on blue/green swap) still uses lsof — that's correct,
  as the prod server is managed differently from preview servers.

### `components/EvolveSessionView.tsx` + `app/evolve/session/[id]/page.tsx`
- Removed `initialDevServerStatus` prop (no longer meaningful).
- Added `proxyServerStatus` state polled from `/_proxy/preview/{id}/status` every 5 s
  when the session is ready.
- Added `serverLogs` state streamed from `/_proxy/preview/{id}/logs` via SSE.
- Added "Preview server" card in the progress area showing status, preview link, and
  collapsible server logs.
- Restart button calls `/_proxy/preview/{id}/restart` directly (no Next.js round-trip).
- `isTerminal` updated to not depend on `devServerStatus` from the SSE stream.

## Why

Preview servers spawned by Next.js became orphaned when the Next.js process was
restarted (hot-reload in dev, blue/green swap in prod). Although the child processes
were `unref()`d and kept running, Next.js lost track of them — leading to port
conflicts and ghost processes. The reverse proxy is the long-lived, stable process
that stays running across deployments, making it the right owner for preview server
lifecycle. This also enables automatic inactivity-based cleanup (30 min) and gives a
clean management API for the session UI.
