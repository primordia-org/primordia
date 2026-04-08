## Zero-downtime blue/green deploy via reverse proxy

### What changed

Introduced a persistent HTTP reverse proxy (`scripts/reverse-proxy.ts`) that sits in front of the Next.js production server and enables true zero-downtime deploys.

**New components:**
- `scripts/reverse-proxy.ts` — lightweight Node.js HTTP/WebSocket proxy; reads upstream port from `primordia-worktrees/proxy-upstream.json`; watches the file with `fs.watch()` and a 5s safety-net poll to pick up upstream changes atomically; handles WebSocket `upgrade` requests so Next.js HMR connections are tunnelled correctly
- `scripts/primordia-proxy.service` — systemd service that keeps the proxy alive permanently, including across blue/green slot swaps

**Modified deploy procedure (`app/api/evolve/manage/route.ts`):**
- Old: health-check new slot on a temp port (start → check → kill) → symlink swap → `systemctl restart primordia` (gap between kill and new server ready)
- New: start new prod server on a free port and keep it running → health check → symlink swap → write new port to `proxy-upstream.json` (proxy switches traffic atomically) → SIGTERM old server (now receiving no traffic)

**Modified rollback (`app/api/rollback/route.ts`):**
- Same zero-downtime approach when `REVERSE_PROXY_PORT` is set; falls back to `systemctl restart` if not configured

**Service file changes (`scripts/primordia.service`):**
- App now binds on `PORT=3001` (not 3000); proxy listens on 3000
- `ExecStartPre` writes the app port to `proxy-upstream.json` before startup so crash-recovery restarts automatically re-register with the proxy

**Install script (`scripts/install-service.sh`):**
- Installs and enables `primordia-proxy.service` alongside the app service
- Creates initial `proxy-upstream.json` if absent

### Why

The previous deploy procedure had a downtime window of ~5–15 seconds on every accepted evolve session: `systemctl restart primordia` killed the old server immediately, and the new server needed time to boot before accepting requests. With the reverse proxy, the new server is fully up and healthy before any traffic is directed to it, eliminating the downtime window entirely.

### New env vars

| Variable | Default | Purpose |
|---|---|---|
| `REVERSE_PROXY_PORT` | — | Port the proxy listens on (e.g. `3000`). Blue/green zero-downtime is only active when this is set. |
| `PRIMORDIA_WORKTREES_DIR` | `/home/exedev/primordia-worktrees` | Set by the systemd service files; tells the proxy and startup wrapper where to find `proxy-upstream.json`. |
