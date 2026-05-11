# Install git hooks from versioned scripts

Primordia now versions its managed Git server hooks under `scripts/git-hooks/` and installs them into the bare repo during `scripts/install.sh`.

The new `reference-transaction` hook detaches linked worktrees during branch ref updates for incoming pushes, then reattaches them after the transaction commits or aborts. It detects `git-receive-pack` in its parent process tree so local operations such as `git worktree add` skip the hook. This lets `git push <remote> <branch>` work even when that branch is currently checked out in one of Primordia's linked worktrees, without interfering with Primordia's own worktree creation.

`scripts/install.sh` now copies the hook into `${BARE_REPO}/hooks/reference-transaction` with executable permissions on every install or update, so fresh servers get the hook and existing servers pick up improvements when the updater runs. It also sets `receive.denyCurrentBranch=ignore` on the bare repo, allowing Git to enter the reference transaction so the hook can detach and reattach checked-out linked worktrees safely.
