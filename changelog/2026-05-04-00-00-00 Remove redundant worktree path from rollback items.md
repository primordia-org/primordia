# Remove redundant worktree path from admin pages; add timestamps to rollback items

## What changed
- Removed the small grey `<p>` that displayed the full filesystem path beneath each branch name on the `/admin/rollback` page.
- Removed the same redundant full path line from the worktree cleanup card on the `/admin/server-health` page.
- Added a timestamp (ctime) to each rollback target on `/admin/rollback`, matching the timestamp already shown on the server health page. The rollback API now returns a `ctimeMs` field per target.

## Why
The full path (e.g. `/home/exedev/primordia/worktrees/deploy-failure-diagnostics`) is an implementation detail that adds visual noise without helping admins identify or choose a slot. The branch name alone is sufficient. Timestamps help admins understand how old each slot is, which aids rollback decision-making — parity with the server health page.
