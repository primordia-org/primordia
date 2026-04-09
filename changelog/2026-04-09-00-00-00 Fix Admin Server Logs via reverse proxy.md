# Fix Admin Server Logs via Reverse Proxy

## What changed

The Admin > Server Logs page was showing no entries in production.

### Root cause

The production Next.js server is a child process of the `primordia-proxy` systemd service — there is no separate `primordia.service` unit. The API route (`/api/admin/logs`) was calling `journalctl -u primordia`, which returned nothing because that unit does not exist. Additionally, both prod server spawn sites in `reverse-proxy.ts` used `stdio: 'ignore'`, so the production server's stdout/stderr were silently discarded.

### Fix

**`scripts/reverse-proxy.ts`**:
- Changed both prod server spawn calls (boot-time `spawnProdServerIfNeeded` and blue/green `handleProdSpawn`) from `stdio: 'ignore'` to `stdio: ['ignore', 'pipe', 'pipe']` and removed `detached: true` + `unref()`.
- Added `prodLogBuffer` (50 KB rolling ring buffer) and `prodLogSubscribers` (active SSE connections).
- Added `appendProdLog()` helper that fills the buffer and fans out to all subscribers.
- Piped both `stdout` and `stderr` of each prod server spawn through `appendProdLog`.
- Added `GET /_proxy/prod/logs` SSE endpoint: sends the current buffer as the first event (skipped when `?n=0`), then streams live output to the client until it disconnects.

**`app/api/admin/logs/route.ts`**:
- When `REVERSE_PROXY_PORT` is set (production), the route now proxies `/_proxy/prod/logs` from the reverse proxy instead of spawning `journalctl`.
- Falls back to `journalctl -u primordia` when no proxy is configured (local dev).

**`app/admin/logs/page.tsx`**:
- In production (`REVERSE_PROXY_PORT` set): fetches `/_proxy/prod/logs` server-side, reads the first SSE event (the ring-buffer snapshot), and passes it as `initialOutput` to `ServerLogsClient`. This pre-renders the current log buffer in the HTML so the page is useful even if client-side JS is broken. Aborts after 2 s if the buffer is empty (fresh server with no output yet).
- In local dev (no proxy): unchanged — uses `spawnSync journalctl` for the initial snapshot.
- `ServerLogsClient` already opens the live SSE stream with `?n=0` (skip history) when `initialOutput` is populated, so the server-side snapshot and the live stream never duplicate lines.
