## Zero-downtime blue/green deploy via reverse proxy

### What changed

Introduced a persistent HTTP reverse proxy (`scripts/reverse-proxy.ts`) that sits in front of the Next.js production server and enables true zero-downtime deploys.

**New components:**
- `scripts/reverse-proxy.ts` — lightweight Node.js HTTP/WebSocket proxy; reads upstream port from `primordia-worktrees/proxy-upstream.json`; watches the file with `fs.watch()` and a 5s safety-net poll to pick up upstream changes atomically; handles all Primordia traffic types (see below)
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

### Traffic types handled by the proxy

A thorough audit of every distinct traffic type Primordia receives was conducted. All are correctly proxied:

| Traffic type | Proxy mechanism | Notes |
|---|---|---|
| Plain HTTP GET/POST/PUT/DELETE (pages, JSON APIs) | `clientReq.pipe(upstreamReq)` → `upstreamRes.pipe(clientRes)` | All HTTP methods forwarded |
| HTTP POST with multipart/form-data (file attachments for evolve) | `clientReq.pipe(upstreamReq)` | Binary body streamed without buffering |
| SSE long-lived responses (`/api/chat`, `/api/evolve/stream`, `/api/admin/logs`, `/api/oops`, `/api/prune-branches`, `/api/git-sync`) | `upstreamRes.pipe(clientRes)` | Node.js HTTP server does not buffer; events flow immediately |
| HTTP responses with `Transfer-Encoding: chunked` (RSC streaming, SSE) | Node.js decodes/re-encodes transparently on both sides | No double-chunking; proxy sees decoded stream |
| 3xx Redirects (Next.js page guards → `/login`) | All response headers forwarded including `Location` | Host header forwarded from client so redirect URLs are correct |
| Git smart HTTP protocol (`/api/git`, `git-upload-pack`, binary pack data) | `clientReq.pipe(upstreamReq)` for both GET (info/refs) and POST (pack data) | Large binary bodies streamed; push blocked at Next.js layer |
| SVG image response (`/api/auth/cross-device/qr`) | Standard response pipe | `Content-Type: image/svg+xml` forwarded |
| WebSocket upgrade (Next.js HMR in dev mode) | `server.on('upgrade')` separate handler | Bidirectional pipe; all WS negotiation headers forwarded verbatim (RFC 6455) |
| HTTP HEAD requests | Method forwarded; empty body pipe is a no-op | ✅ |
| HTTP OPTIONS (CORS preflight) | Method forwarded | ✅ |
| Next.js RSC flight protocol (client-side navigation, prefetch) | Standard GET/POST with special `RSC:1` / `Next-Router-*` headers forwarded | ✅ |
| Static assets (`/_next/static/`, `/favicon.ico`, `/robots.txt`) | Standard response pipe | ✅ |
| Session cookies (`Cookie` / `Set-Cookie`) | Forwarded via `...incoming.headers` / `upstreamRes.headers` | ✅ |
| exe.dev SSO headers (`X-ExeDev-UserID`, `X-ExeDev-Email`) | Forwarded via `...incoming.headers` | ✅ |

**Proxy correctness fixes applied in this PR:**

1. **Hop-by-hop header stripping** — `forwardHeaders()` now strips `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `proxy-connection`, `te`, `trailers`, and any headers named in the `Connection` header's value before forwarding to upstream (RFC 7230 §6.1). `transfer-encoding` and `upgrade` are intentionally left alone (Node.js handles chunked re-encoding; the upgrade path has its own handler).

2. **`x-forwarded-host` header** — `forwardHeaders()` now sets `x-forwarded-host` from the incoming `host` header (if not already set). The exe.dev SSO route uses this header to reconstruct the public origin for redirect URLs.

3. **WebSocket head buffer variable fix** — The `unshift()` calls after a successful WebSocket upgrade had their variables swapped: `upstreamHead` (bytes from the upstream after its 101) should be replayed into `clientSocket`, and `head` (bytes from the client after its Upgrade request) should be replayed into `upstreamSocket`. Both were going to the wrong socket. Fixed.

4. **Pre-upgrade `clientSocket` error handler** — An error handler is now attached to `clientSocket` immediately when the upgrade event fires, before the upstream `http.request()` is made. This prevents an unhandled error if the client disconnects while waiting for the upstream 101 response.

### New env vars

| Variable | Default | Purpose |
|---|---|---|
| `REVERSE_PROXY_PORT` | — | Port the proxy listens on (e.g. `3000`). Blue/green zero-downtime is only active when this is set. |
| `PRIMORDIA_WORKTREES_DIR` | `/home/exedev/primordia-worktrees` | Set by the systemd service files; tells the proxy and startup wrapper where to find `proxy-upstream.json`. |
