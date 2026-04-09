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

## Why

- The proxy is a bun script, not an OS-level service dependency, so there is no scenario where it is running but `REVERSE_PROXY_PORT` is unset. Keeping the fallback paths added dead code and masked misconfiguration.
- Primordia can be developed on macOS, which does not have `systemd`. The `update-service.sh` script previously would fail on `command not found: systemctl`, but it is called as part of every blue-green accept. Skipping it silently on non-systemd platforms makes the accept flow work correctly on macOS.
