# Run update-service on blue-green deploy

## What changed

- Added `scripts/update-service.sh` — a lightweight complement to `install-service.sh` for already-running servers.
- `update-service.sh` compares `scripts/reverse-proxy.ts` and `scripts/primordia-proxy.service` from the incoming worktree against the currently installed copies, and:
  - Runs `sudo systemctl daemon-reload` only when the service unit file changed.
  - Runs `sudo systemctl restart primordia-proxy` only when the proxy script (`~/primordia-proxy.ts`) changed.
  - Exits silently (no sudo calls at all) when neither file changed — the common case.
- `scripts/install-service.sh` is unchanged in behaviour; its header comment now notes that `update-service.sh` should be used for subsequent deploys.
- `app/api/evolve/manage/route.ts` — `blueGreenAccept()` now runs `scripts/update-service.sh` from the incoming worktree as step 2 (after `bun install`, before starting the new prod server). The call is non-fatal: a failure is logged as a warning in the session progress log but does not abort the slot swap.

## Why

Previously, changes to `scripts/reverse-proxy.ts` or `scripts/primordia-proxy.service` only took effect after a manual `bash scripts/install-service.sh` on the server. Blue-green prod deploys swapped Next.js production slots but left the proxy process and systemd unit unchanged, meaning proxy improvements or service configuration tweaks were silently ignored until an admin SSH'd in and re-ran the install script.

With this change, every accepted evolve request automatically applies service-level changes as part of the deploy, with no extra manual steps.
