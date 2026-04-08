# Remove `current` symlink; install proxy at stable location; use PROD symbolic-ref for routing

## What changed

### Problem
The blue/green deploy flow left worktree directories in a detached-HEAD state:
- The session worktree had its HEAD detached onto the merge commit so the session branch ref could be deleted.
- The old production slot was also detached before checking out `parentBranch` in the new slot.
- The `current` symlink always pointed to a directory with a detached HEAD, so the reverse proxy could never read the branch name from HEAD — it was always detached.

### Solution

#### 1. Keep worktrees on their branches (no more detached HEAD)
Instead of detaching HEAD and deleting the session branch, the blue/green accept now:
- Creates the merge commit via git plumbing (advances `parentBranch` as before).
- **Fast-forwards the session branch ref** to the same merge commit (`git update-ref refs/heads/{branch} <mergeCommit>`). Since the session worktree's HEAD is `ref: refs/heads/{branch}`, it automatically lands on the merge commit without any checkout.
- Keeps the session branch alive — the new production worktree stays checked out on it.
- Leaves the old production worktree on whatever branch it had before (no detach needed since both slots are on distinct branches).

#### 2. Keep all old production slots for deep rollback
Old production slots are **no longer deleted** after two accepts. They accumulate indefinitely as registered git worktrees, which enables rolling back to any past production state. The veryOldSlot cleanup code has been removed from the blue/green accept path.

#### 3. PROD symbolic-ref as the authoritative production pointer
A new git symbolic-ref called `PROD` (`refs/heads/{session-branch}`) is written after each successful accept and rollback. The reverse proxy now reads `git symbolic-ref --short PROD` to determine which branch is production, then looks up `branch.{name}.port` in git config. This:
- Eliminates the hard-coded reliance on `main`'s port (3001) as the production port.
- Decouples the proxy from the `current` symlink's HEAD (which was always detached).
- Makes it trivial to determine the production branch and port purely from git.

#### 4. Proxy watches `.git/PROD`
The reverse proxy now watches both `.git/config` (existing) and `.git/PROD` (new) for changes. A `setupProdWatch()` function retries every 5 s until the file appears (it's created on the first accept). The `scheduleSlotActivation` path also re-writes `branch.{session-branch}.port` to git config (same value) to immediately trigger the existing `fs.watch` on `git/config` so the proxy picks up the new PROD branch without waiting for the 5 s poll.

#### 5. Bootstrap in `install-service.sh`
`install-service.sh` now sets `PROD → refs/heads/main` on first install (guarded — never overwrites a live PROD pointer on re-install). This ensures the proxy can route immediately after a fresh deploy, before the first accept.

#### 6. Rollback updated
- Removed the old HEAD-reattachment block from `rollback/route.ts` (no longer needed since both slots stay on their branches).
- Rollback now reads the old production port from `PROD` (with fallback to HEAD for pre-PROD deployments) rather than the post-swap `current` slot (which was reading the wrong slot's port).
- After a successful rollback, `PROD` is updated to point to the rolled-back slot's branch.

#### 7. Deep rollback admin page (`/admin/rollback`)
Since the PROD symbolic-ref has a git reflog and old worktrees are no longer deleted, the system now supports rolling back to any past production slot:
- `GET /api/admin/rollback` reads the PROD reflog (ordered newest-first), matches each historical commit hash against registered git worktrees, and returns the ordered list of available rollback targets.
- `POST /api/admin/rollback { worktreePath }` starts the target slot's server on a free port, health-checks it, updates the slot tracker, updates `PROD`, and gracefully kills the old server — the same zero-downtime path as the forward blue/green accept.
- `/admin/rollback` is a new admin page (with its own tab in the admin subnav) that displays the current production branch and all previous slots as a list with "Roll back" buttons.

#### 8. Remove `current`/`previous` symlinks; install proxy at a stable location
The `primordia-worktrees/current` and `primordia-worktrees/previous` symlinks are fully removed:

**Proxy installed at `~/primordia-proxy.ts`**: `install-service.sh` now copies `scripts/reverse-proxy.ts` to `$HOME/primordia-proxy.ts` on every run. The `primordia-proxy.service` systemd unit references this stable absolute path directly (`ExecStart=/home/exedev/.bun/bin/bun /home/exedev/primordia-proxy.ts`), so the service file needs no symlink resolution or `bun run proxy` indirection.

**Proxy discovers the main repo dynamically**: Instead of hard-coding `primordia-worktrees/main` (which does not exist — the main repo is at `/home/exedev/primordia`, a sibling of the worktrees directory), the proxy's `discoverMainRepo()` function reads any worktree in `PRIMORDIA_WORKTREES_DIR` and follows `git rev-parse --git-common-dir` to find the canonical `.git` directory. This makes the proxy work correctly regardless of the actual layout. `primordia-proxy.service` uses `WorkingDirectory=/home/exedev/primordia` and `EnvironmentFile=/home/exedev/primordia/.env.local` as the stable baselines (the main repo, not a non-existent `main` worktree).

**No `primordia.service` — proxy starts the production Next.js server**: There is only one systemd service: `primordia-proxy`. On startup, after reading the PROD ref and port, the proxy calls `startProdServerIfNeeded()`: it checks if something is already listening on the upstream port, and if not, finds the production worktree via `git worktree list` and spawns `bun run start` there. This makes the proxy the sole long-running process managed by systemd. `scripts/primordia.service` has been removed.

**No `primordia.current-slot` / `primordia.previous-slot` git config entries**: The PROD symbolic-ref is the authoritative source for the current production slot. The "previous slot" is `PROD@{1}` (the PROD reflog entry before the last accept). All routes and scripts that previously read/wrote these git config entries now use `git symbolic-ref PROD` + `git worktree list` lookups instead. `install-service.sh` no longer writes these entries; the accept and rollback flows no longer write them either.

**`install-service.sh` simplified**: The script no longer accepts a worktree path argument, no longer installs `primordia.service`, and no longer writes any systemd drop-in files. It only: symlinks `primordia-proxy.service`, copies `reverse-proxy.ts` to `~/primordia-proxy.ts`, initialises PROD on first install, and starts the proxy service.

**`scripts/rollback.ts` updated**: The CLI rollback script now uses PROD + `git worktree list` to find current and previous slots, updates PROD symbolic-ref to the previous branch, and restarts `primordia-proxy` (which starts the production server automatically). No more symlink manipulation.

## Why
The `current` symlink approach had a fundamental flaw: git considers the symlink a separate entity from the worktree it points to, so `git symbolic-ref HEAD` inside `current` always returned nothing (detached). The PROD symbolic-ref lives in the shared `.git` directory and is visible from any worktree in the repo, making it the correct tool for tracking which branch is production. A natural consequence is that the git reflog for PROD provides a complete, ordered history of every production deployment — making it the ideal source of truth for rollback targets without any additional bookkeeping.

The `primordia.current-slot` git config entry was redundant: PROD already encodes which branch (and thus which worktree) is production. Similarly, `primordia.previous-slot` is redundant with `PROD@{1}`. Removing these entries means there is only one place to update on accept/rollback (the PROD ref), eliminating a class of consistency bugs.

The separate `primordia.service` for the Next.js app was a convenience that added complexity without benefit once the proxy existed. Having the proxy spawn the production server on boot means one fewer systemd unit to manage, and the proxy already knew about the production port — so it naturally owns the server lifecycle.
