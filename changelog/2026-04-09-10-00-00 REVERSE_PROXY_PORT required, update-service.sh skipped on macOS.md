# REVERSE_PROXY_PORT required; update-service.sh skipped on macOS

## What changed

### `REVERSE_PROXY_PORT` is now a required environment variable

Previously this was optional, with fallback code paths that would `sudo systemctl restart primordia-proxy` when the variable was unset. Since the reverse proxy is a plain bun server (not an external dependency like caddy), there is no valid production setup where `REVERSE_PROXY_PORT` would be absent.

Removed fallback paths in:
- `app/api/evolve/manage/route.ts` — `spawnProdViaProxy()` no longer has a `systemctl restart` fallback; reject and `retryAcceptAfterFix` paths no longer guard the proxy DELETE call behind `if (proxyPort)`
- `app/api/rollback/route.ts` — the `else` branch that fell back to `systemctl restart` is gone; the zero-downtime proxy path is now unconditional
- `app/api/admin/rollback/route.ts` — same
- `lib/evolve-sessions.ts` — `previewUrl` is always set (no `if (proxyPort)` guard); `restartDevServerInWorktree` no longer throws when `REVERSE_PROXY_PORT` is absent

Updated `.env.example` to uncomment `REVERSE_PROXY_PORT=3000` and mark it as required.

Updated `PRIMORDIA.md` environment variable table accordingly.

### `update-service.sh` now exits cleanly on macOS (no systemd)

Added an early-exit guard at the top of `scripts/update-service.sh`:

```bash
if ! command -v systemctl &>/dev/null; then
  echo "systemctl not available — skipping service update."
  exit 0
fi
```

This means `update-service.sh` can safely be called as part of the blue-green accept flow on macOS developer machines without failing. The script simply skips all systemd work when `systemctl` is not present.

### Remove dead journalctl fallback from admin server logs

After merging the admin-logs-reverse-proxy-integration branch, the admin logs API and page still contained a `journalctl -u primordia` fallback for when `REVERSE_PROXY_PORT` was unset. Since `REVERSE_PROXY_PORT` is now required, that code was dead. Removed:

- `app/api/admin/logs/route.ts` — removed the `spawn("journalctl", ...)` fallback; now unconditionally proxies `/_proxy/prod/logs`
- `app/admin/logs/page.tsx` — removed the `spawnSync("journalctl", ...)` fallback for SSR pre-fetch; now unconditionally reads from the proxy

### Proxy logs and rollback script degrade gracefully on macOS

The merged admin-logs branch also added `app/api/admin/proxy-logs/route.ts` and `app/admin/proxy-logs/page.tsx`, both of which unconditionally spawned `journalctl`. On macOS (no systemd) this would crash or emit unhelpful errors. Fixed:

- `app/api/admin/proxy-logs/route.ts` — checks `process.platform !== "linux"` before spawning journalctl; returns an informational SSE message on other platforms explaining that proxy logs require systemd
- `app/admin/proxy-logs/page.tsx` — guards the `spawnSync("journalctl", ...)` SSR pre-fetch behind `process.platform === "linux"`; falls back to `""` on other platforms

`scripts/rollback.ts` previously called `sudo systemctl restart primordia-proxy` unconditionally. Fixed:

- Added a `which systemctl` check before the restart; on macOS (or any system without systemd) it prints a reminder to restart the proxy manually and exits cleanly

## Why

- The proxy is a bun script, not an OS-level service dependency, so there is no scenario where it is running but `REVERSE_PROXY_PORT` is unset. Keeping the fallback paths added dead code and masked misconfiguration.
- Primordia can be developed on macOS, which does not have `systemd`. The `update-service.sh` script previously would fail on `command not found: systemctl`, but it is called as part of every blue-green accept. Skipping it silently on non-systemd platforms makes the accept flow work correctly on macOS.
- The newly merged proxy-logs pages and rollback script contained unconditional `journalctl`/`systemctl` calls. On macOS these would either crash or emit confusing errors. The platform guards ensure the app remains functional on macOS while still providing full functionality on Linux.
