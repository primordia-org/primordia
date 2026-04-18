# Create dedicated primordia service user with scoped sudoers

## What changed

- `scripts/install-service.sh` now creates a dedicated `primordia` system user (no login shell) to run the reverse proxy service instead of running as the `exedev` human user.
- A `/etc/sudoers.d/primordia` file is installed with exactly three allowed commands:
  1. `systemctl daemon-reload` — to pick up unit file changes after deploys
  2. `systemctl restart primordia-proxy` — for deploys and rollbacks
  3. `tee /etc/systemd/system/primordia-proxy.service` — to write the updated unit file
- The systemd service unit is now **written** (not symlinked) to `/etc/systemd/system/` with the correct runtime paths embedded. The `primordia-proxy.ts` file lives at `/home/primordia/primordia-proxy.ts` and the env file at `/home/primordia/.env.local`.
- Repo and worktrees directories have their group changed to `primordia` with group-write and setgid bits, so both the `exedev` installing user and the `primordia` service user can read and write them.
- `scripts/update-service.sh` updated to use the new stable proxy path and to regenerate/compare the service unit content instead of diffing against the static template file.
- `scripts/primordia-proxy.service` updated to reflect the `primordia` user and `/home/primordia` paths (serves as canonical reference).
- `scripts/install.sh` fixed: when installing from a preview/session branch URL the repo is cloned with that branch already checked out, causing `git worktree add` to fail with "already used by worktree". The script now detects this and switches the main clone to `main` before creating the production worktree.
- `scripts/install-service.sh` now **copies** the bun binary to `/usr/local/bin/bun` instead of symlinking it. A symlink through `/home/exedev/.bun/bin/bun` requires traversal of `/home/exedev` (mode `750`), which the `primordia` user cannot do.
- The service unit's `WorkingDirectory` now points to the actual main git repo (e.g. `/home/exedev/primordia`) instead of `/home/primordia`. The proxy's `discoverMainRepo()` falls back to `process.cwd()`, and setting it to a non-git directory caused the proxy to fail to find `primordia.productionBranch` and never start the production server.

## Why

The proxy previously ran as `exedev` — the same user that SSHes into the machine and holds broad `sudo` privileges. Running a network-facing service as a privileged human account violates the principle of least privilege: a successful exploit of the proxy would yield full sudo access.

The `primordia` system user is a dedicated service account whose only elevated capabilities are the three systemctl/tee commands genuinely needed for zero-downtime deploys. Every other system operation is blocked.
