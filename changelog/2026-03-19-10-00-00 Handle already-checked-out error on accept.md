# Handle already-checked-out error on accept

## What changed

In `app/api/evolve/local/manage/route.ts`, the `accept` action now handles the case where the parent branch is already checked out in another git worktree.

Previously, if you had stacked evolve sessions (session B was started while the main repo was already on an `evolve/...` branch from session A), clicking "Accept" on session B would fail with:

```
git checkout evolve/<parent-branch> failed:
fatal: '<parent-branch>' is already checked out at '<path>'
```

## Why

Git refuses to check out a branch that is already checked out in any linked worktree. When a user has multiple overlapping evolve sessions the parent branch can be an `evolve/...` branch that lives in another worktree rather than in the main repo root.

## How

After a failed `git checkout`, we now match git's error message against `already checked out at '<path>'`. If matched, we use the reported path as `mergeRoot` (the directory in which to run `git merge`) instead of `parentRepoRoot`. Any other checkout failure still surfaces as an error response unchanged.
