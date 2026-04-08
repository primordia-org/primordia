# Replace `current` symlink HEAD detection with PROD symbolic-ref for proxy routing

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

#### 2. Clean up retired branches on the two-accepts-ago slot
When the very-old slot (two accepts ago) is removed, its session branch ref and git config section are now also deleted.

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

## Why
The `current` symlink approach had a fundamental flaw: git considers the symlink a separate entity from the worktree it points to, so `git symbolic-ref HEAD` inside `current` always returned nothing (detached). The PROD symbolic-ref lives in the shared `.git` directory and is visible from any worktree in the repo, making it the correct tool for tracking which branch is production.
