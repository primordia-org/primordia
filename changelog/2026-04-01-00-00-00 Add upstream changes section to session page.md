# Add upstream changes section to session page

## What changed

Added an **Upstream Changes** banner to the evolve session page that appears when the session's parent branch has commits that are not yet in the session branch.

### New UI (`components/EvolveSessionView.tsx`)

- A blue info card is shown above the action panel when the parent branch is ahead of the session branch.
- Displays the commit count and the names of both branches for context.
- Provides two buttons: **Merge** (creates a merge commit) and **Rebase** (replays session commits on top of the parent branch).
- After a successful merge or rebase the banner disappears automatically.
- Error messages from the git operation are displayed inline.

### New API route (`app/api/evolve/upstream-sync/route.ts`)

- `POST /api/evolve/upstream-sync` — accepts `{ sessionId, action: "merge" | "rebase" }`.
- Runs the git operation inside the session's worktree directory.
- On conflict, automatically aborts the merge/rebase and returns an error so the worktree is left in a clean state.

### Server component (`app/evolve/session/[id]/page.tsx`)

- Added `getUpstreamCommitCount(sessionBranch)` helper that reads the parent branch from `git config branch.<name>.parent` and runs `git rev-list <session>..<parent> --count`.
- Passes the result as `upstreamCommitCount` prop to `EvolveSessionView`.

## Why

When the main branch (or any parent branch) advances while a session is in progress, accepting the session branch without first incorporating those upstream commits can cause the accepted merge to overwrite or conflict with the new work. Surfacing this information and providing one-click merge/rebase makes it easy to keep the session branch up to date before accepting.
