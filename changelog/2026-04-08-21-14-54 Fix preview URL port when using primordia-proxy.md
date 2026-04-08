# Fix preview URL port when using primordia-proxy

## What changed

When a preview dev server becomes ready and `REVERSE_PROXY_PORT` is set (i.e. primordia-proxy is running), the generated `previewUrl` no longer includes the proxy's port number.

**Before:** `http://hostname:3000/preview/{sessionId}`
**After:** `http://hostname/preview/{sessionId}`

The fix applies to both the initial dev server start (in `startLocalEvolve`) and the kill-restart path (in `killAndRestartDevServer`) in `lib/evolve-sessions.ts`.

## Why

primordia-proxy is the public-facing server. Its port (e.g. 3000) is an internal implementation detail — the proxy is typically exposed at the hostname root (port 80/443 via a front-end load balancer, or directly as the bound public port on exe.dev). Including `:3000` in the preview URL produced a broken link that required the user to manually remove the port to access the preview.
