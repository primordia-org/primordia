# Zero-downtime install when proxy and service are unchanged

`scripts/install.sh` now performs a zero-downtime slot swap when updating an existing installation, as long as neither `reverse-proxy.ts` nor the systemd service unit changed.

## What changed

The install/deploy section of `install.sh` was restructured into two paths:

**Zero-downtime path** (new, used on updates where proxy+service are unchanged):
- Assigns an internal TCP port to the branch in git config (required by `/_proxy/prod/spawn`)
- Copies the production SQLite DB via `VACUUM INTO` (atomic snapshot, same as "Accept Changes")
- Fixes the `.env.local` symlink to point to the main repo copy
- Calls `POST /_proxy/prod/spawn` — the proxy spawns the new prod server, health-checks it, and cuts over traffic atomically, leaving the old server running until the new one is ready
- Advances `git branch -f main` only after successful cutover

**Restart/start path** (used on first install, proxy/service changed, or zero-downtime failure):
- Sets `primordia.productionBranch` in git config directly (proxy reads it on start)
- Runs `systemctl start` or `systemctl restart` as before
- Polls HTTP until the service responds

## Why

Running the install script to push a code update previously restarted the systemd service (= killed the proxy = killed the production Next.js server = downtime while it rebuilt). The "Accept Changes" flow in the app already has zero-downtime semantics via `/_proxy/prod/spawn`. The installer now uses the same endpoint on updates, matching what a normal evolve cycle does.

The restart path is kept as a fallback because it is unavoidable when the proxy script itself or the systemd unit changes (those changes can't be applied without restarting the proxy).
