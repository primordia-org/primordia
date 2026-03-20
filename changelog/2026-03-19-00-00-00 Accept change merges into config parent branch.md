# Accept change merges into `git config branch.<branch>.parent`

## What changed

In `app/api/evolve/local/manage/route.ts`, the `accept` action now explicitly checks out the `parentBranch` (read from `git config branch.<branch>.parent`) in the main repo before performing the merge.

Previously, `git merge` was run directly against the main repo's working tree without first switching branches. This meant the merge landed on whichever branch happened to be checked out in the main repo at the time — typically `main`, but not reliably so.

## Why

The parent branch is stored in git config by `startLocalEvolve` (in `lib/local-evolve-sessions.ts`) as `branch.<evolveBranch>.parent` at session-creation time, capturing the exact branch the user was on when they triggered evolve. Accepting a change should always merge back to that originating branch — not to whatever is accidentally checked out.

The fix adds a `git checkout <parentBranch>` step immediately before the merge, with a clear error response if the checkout fails.
