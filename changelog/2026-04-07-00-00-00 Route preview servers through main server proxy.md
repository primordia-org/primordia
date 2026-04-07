# Route preview servers through main server proxy

## What changed

Preview dev servers are now started with `NEXT_BASE_PATH=/preview/{sessionId}` and accessed via a new proxy route on the main server (`/preview/[sessionId]/[[...path]]`), rather than being accessed directly on their own port.

**New file:** `app/preview/[sessionId]/[[...path]]/route.ts` — an HTTP proxy route handler that looks up the session's port from the database and forwards all requests to `http://localhost:{port}/preview/{sessionId}/...`, passing through headers and bodies.

**Changes to `lib/evolve-sessions.ts`:**
- Both `startLocalEvolve` and `restartDevServerInWorktree` now inject `NEXT_BASE_PATH=/preview/{sessionId}` (prefixed by the main app's own base path if set) into the preview dev server's environment at spawn time.
- `previewUrl` is now set to `/preview/{sessionId}` (a path on the same origin) instead of `http://{hostname}:{port}` (an external port URL).

## Why

Previously, preview servers ran on arbitrary ports (e.g. 3001, 3002) and the preview link pointed directly to that port on the same host. This caused two problems:

1. **Port exposure**: Users had to access a different port, which could be blocked by firewalls or require awkward URLs.
2. **Cross-origin issues**: Cookies set by the main app (session cookies etc.) were not automatically sent to the preview server since it ran on a different port (different origin). This broke authentication in previews.

By proxying through the main server:
- The preview is accessible at `/preview/{sessionId}` on the same origin — no port differences.
- All cookies from the main app are sent transparently with every proxied request.
- The preview server's `NEXT_BASE_PATH` matches its proxied path, so all internal Next.js links, API calls, and client-side fetches work correctly within the preview.

Note: HMR (hot module replacement) WebSocket connections are not proxied (route handlers cannot upgrade WebSocket connections). This is acceptable since previews are for reviewing changes, not live development.
