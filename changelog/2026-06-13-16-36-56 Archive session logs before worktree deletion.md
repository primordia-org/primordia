# Archive session logs before worktree deletion

## What changed

- Added session NDJSON archival before evolve worktrees are deleted.
- Rejected evolve sessions now gzip their `.primordia-session.ndjson` log into `PRIMORDIA_DIR/past-sessions` before removing the worktree and branch.
- Manual server-health cleanup and automatic reverse-proxy disk cleanup also archive any session log present in the target worktree before deletion.

## Why

Deleting a worktree previously deleted its structured session log with it. Keeping a gzipped copy under `past-sessions/` preserves the request, agent output, decisions, and metrics for later inspection without keeping the full worktree on disk.
