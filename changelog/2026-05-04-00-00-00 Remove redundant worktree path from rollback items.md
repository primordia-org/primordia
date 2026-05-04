# Remove redundant worktree path from rollback items

## What changed
Removed the small grey `<p>` element that displayed the full filesystem path (e.g. `/home/exedev/primordia/worktrees/deploy-failure-diagnostics`) beneath each branch name in the `/admin/rollback` list.

## Why
The path is an implementation detail that adds visual noise without helping the admin choose a rollback target. The branch name alone is sufficient to identify each slot.
