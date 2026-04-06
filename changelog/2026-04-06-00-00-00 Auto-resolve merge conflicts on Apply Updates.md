# Auto-resolve merge conflicts on Apply Updates

## What changed

The "Apply Updates" button (`POST /api/evolve/upstream-sync`) previously returned an unhelpful
`"Merge failed:"` error when the upstream parent branch conflicted with the session branch.

It now auto-resolves conflicts using Claude (the same `resolveConflictsWithClaude` helper that
the Accept flow already uses) before giving up:

1. `git merge <parentBranch>` is attempted as before.
2. If the merge exits with a non-zero code (conflict), `resolveConflictsWithClaude` is called
   in the session worktree — Claude reads each conflicted file, resolves the markers, stages
   the files, and commits the merge.
3. On success the endpoint returns `{ outcome: "merged-with-conflict-resolution" }` (HTTP 200)
   and the frontend clears the upstream-commits indicator as normal.
4. Only if Claude also fails to resolve the conflict is `git merge --abort` run and the error
   surfaced to the user.

## Why

A merge conflict during "Apply Updates" previously left the session worktree in an aborted
state with no actionable error, forcing the user to abandon the session. Auto-resolution via
Claude is consistent with how the Accept gate already handles conflicts and eliminates this
dead-end for the majority of real-world conflicts.
