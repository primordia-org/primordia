# Fix credentials deletion race condition in concurrent Claude workers

## What changed

`scripts/claude-worker.ts` now uses per-PID lock files to guard the shared
`credentials.json` file against premature deletion when multiple worker
processes are running simultaneously for the same user.

### Before

Each Claude Code worker wrote the user's `credentials.json` to
`CLAUDE_CONFIG_DIR` (e.g. `~/.claude-users/{userId}/.credentials.json`) on
startup and unconditionally deleted it in `cleanup()` on exit.  If two agents
were running concurrently for the same user, whichever one finished first would
delete the file while the other was still mid-run, causing the second agent to
fail with an authentication error.

### After

A per-PID lock file (`.credentials.{pid}.lock`) is created in `CLAUDE_CONFIG_DIR`
**before** `credentials.json` is written.  The `cleanup()` function:

1. Removes this worker's own lock file.
2. Reads the directory to check whether any other `.credentials.*.lock` files
   remain.
3. Only deletes `credentials.json` if **no** lock files remain.

Writing the lock file before the credentials file means that any concurrent
`cleanup()` racing against the incoming worker will see at least one lock file
and leave `credentials.json` intact.

## Why

Two or more evolve sessions belonging to the same user can run in parallel.
Because `CLAUDE_CONFIG_DIR` is scoped per-user (not per-session), they share
the same `credentials.json`.  Without coordination the first session to finish
deleted the file, breaking all still-running sessions for that user.
