# Fix blue-green proxy cutover, accept copy, and rollback-safe blue-green deploy

## What changed

### Proxy cutover reliability (`scripts/reverse-proxy.ts`, `app/api/evolve/manage/route.ts`)

After an accept, the production server calls `scheduleSlotActivation` to:
1. Set the `PROD` git symbolic-ref to the session branch
2. Touch `.git/config` to trigger the proxy's `fs.watch`
3. After 500 ms, kill the old server

The problem: `fs.watch` on Linux uses inotify, which can silently miss events. If the watch didn't fire, the proxy would keep routing to the old (soon-to-be-dead) server for up to 5 seconds (the safety-net poll interval), causing 502 errors.

**Fix:**
- Added a `POST /_proxy/refresh` management endpoint to the reverse proxy that calls `readAllPorts()` immediately — re-reading the `PROD` symbolic-ref and all branch ports from git config.
- Changed `scheduleSlotActivation` to call `/_proxy/refresh` via HTTP right after setting `PROD`, instead of relying on `fs.watch`. The old server is killed 200 ms after the proxy confirms the refresh (down from 500 ms).
- The 5-second poll and file watches remain as a belt-and-suspenders fallback.

### Rollback-safe blue-green accept (`app/api/evolve/manage/route.ts`)

The previous accept implementation created a synthetic merge commit `M` via `git commit-tree` and advanced **both** `parentBranch` and `sessionBranch` refs to `M`. This broke deep rollback:

- The PROD reflog rollback works by matching previous PROD commit hashes against current worktree HEAD hashes.
- When `parentBranch` was advanced to `M`, the old slot's worktree HEAD also updated to `M` (because it is checked out on that branch).
- So `hashToWorktree.get(previousProdCommit)` found nothing, and the rollback page showed no rollback targets.

**Fix:** Remove `createMergeCommitNoCheckout` entirely.

- Gate 1 (ancestor check) already guarantees the session branch contains all commits from `parentBranch`, so the session branch tip IS the correct production tree — no merge commit needed.
- `parentBranch` is intentionally **not advanced**. The old slot stays at its pre-accept commit hash, which the PROD reflog rollback can still match.
- A new `reparentSiblings()` helper updates `branch.{X}.parent` in git config for any sibling sessions that were branching off the old `parentBranch`, so their "Apply Updates" button will correctly pick up the new production code going forward.

### Accept confirmation copy (`components/EvolveSessionView.tsx`)

Updated the text shown when a user opens the "Accept Changes" panel in production mode to accurately describe the new behavior: no merge commit is created; the parent branch stays at its current commit so the old slot can be rolled back to.

## Why

1. A user accepted a branch and the session page still showed the old production branch name (`prod-branch-symbolic-ref`) at the top — because the proxy hadn't switched yet (fs.watch missed the event). The explicit `/_proxy/refresh` call eliminates this race.
2. After examining the blue-green accept flow, it became clear that creating a merge commit that advances both branches defeats the PROD reflog rollback mechanism. The fix makes rollback reliably work: every old slot stays at its original commit hash, which the rollback page can always find.
