# Auto-resolve merge conflicts on Accept Changes

## What changed

When a user clicks **Accept Changes** on a local preview instance and the
`git merge` into the parent branch fails (e.g. due to conflicts between the
preview branch and changes that have landed on the parent branch since the
worktree was created), the system now automatically attempts to resolve the
problem using Claude Code before surfacing an error to the user.

### New function — `resolveConflictsWithClaude` (`lib/local-evolve-sessions.ts`)

A new exported helper that:

1. Receives the `mergeRoot` directory, the `branch` being merged, and the
   `parentBranch` it is merging into.
2. Runs `query()` (Claude Agent SDK) with a targeted prompt asking Claude to:
   - Inspect `git status` for conflicted files.
   - Read, resolve, and re-write each conflicted file.
   - Stage resolved files with `git add`.
   - Complete the merge with `git commit --no-edit`.
3. After Claude finishes, verifies that `MERGE_HEAD` no longer exists (i.e.
   the merge was actually committed).
4. Returns `{ success: true }` on success or `{ success: false, log }` with
   Claude's full output log on failure.

### Updated accept handler (`app/api/evolve/local/manage/route.ts`)

- Imports `resolveConflictsWithClaude` from `local-evolve-sessions`.
- After a failed `git merge`, calls `resolveConflictsWithClaude` instead of
  immediately returning a 500 error.
- If Claude succeeds, falls through to the normal worktree cleanup path and
  returns `{ outcome: 'accepted' }` — the user sees the same "Changes accepted"
  confirmation as a clean merge.
- If Claude also fails, calls `git merge --abort` to restore a clean state and
  returns a descriptive 500 error containing both the original merge error and
  Claude's resolution log.

## Why

Previously a diverged parent branch would silently block the Accept flow with
a generic merge error, requiring the developer to resolve conflicts manually in
the terminal.  Since Primordia is a self-modifying app that relies on AI to
make changes, it is natural to also use AI to handle the routine task of
conflict resolution, keeping the one-click accept experience intact even when
the parent branch has moved forward.
