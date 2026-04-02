# Add 20-minute timeout to Claude Code step

## What changed

Added a 20-minute timeout to the Claude Code `query()` call in both `startLocalEvolve` and `runFollowupInWorktree` in `lib/evolve-sessions.ts`.

**Mechanism:**
- An `AbortController` is created before each `query()` call and passed via `options.abortController`.
- A `setTimeout` fires after 20 minutes, sets a `claudeTimedOut` flag, and calls `abortController.abort()` to kill the Claude Code process.
- The `finally` block clears the timeout if Claude finishes normally.
- In the `catch` block, if `claudeTimedOut` is true, the abort error is swallowed rather than propagated to the outer error handler.

**Behavior on timeout:**
- `startLocalEvolve`: appends a timeout notice to the progress log, then falls through to start the preview dev server — the session lands in `ready` state with whatever work Claude completed before the timeout.
- `runFollowupInWorktree`: appends a timeout notice, sets `session.status = 'ready'`, persists, and returns early — leaving the session interactive for the user to review or submit another follow-up.

## Why

Claude Code occasionally runs indefinitely on complex or ambiguous requests, blocking the evolve pipeline and holding a `running-claude` status forever. The 20-minute cap ensures sessions always reach a terminal interactive state so users aren't left waiting indefinitely.
