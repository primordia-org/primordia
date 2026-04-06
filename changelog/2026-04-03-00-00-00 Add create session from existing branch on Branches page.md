# Add "create session" for existing branches

## What changed

- **New API endpoint** `POST /api/evolve/from-branch` — creates an evolve session on an existing local git branch. Accepts `{ branchName, request? }`. Uses Claude Haiku to generate a clean kebab-case session ID from the branch name (because branch names can contain slashes and other characters that aren't valid as directory names). Falls back to sanitising the branch name directly if Haiku is unavailable.

- **`lib/evolve-sessions.ts`** — `startLocalEvolve` now accepts an optional `options.skipBranchCreation` flag. When true, the worktree setup runs `git worktree add <path> <branch>` (check out existing branch) instead of `git worktree add <path> -b <branch>` (create new branch). All other setup steps (bun install, DB copy, .env.local symlink, Claude Code run, dev server) are unchanged. The DB copy step now uses SQLite's `VACUUM INTO` statement (the same approach already used in `manage/route.ts` and `rollback/route.ts`) instead of `fs.copyFileSync`. `VACUUM INTO` opens the source database, incorporates any pending WAL data, and writes a clean WAL-free snapshot to the destination in a single atomic operation — safe while the source is actively being written to, and no need to avoid copying `-wal`/`-shm` sidecar files.

- **New component** `components/CreateSessionFromBranchButton.tsx` — a client-side "+ session" button shown next to eligible branches on the Branches page. Clicking it expands an inline form where the user can optionally describe what they want to do. On submit it POSTs to `/api/evolve/from-branch` and navigates to the new session page.

- **`app/branches/page.tsx`** — the Branches page now checks `hasEvolvePermission` and shows `CreateSessionFromBranchButton` next to any branch that has no active evolve session, is not `main`, and is not the currently checked-out branch. The legend was updated to explain the new button.

## Why

External contributors push branches directly to the repo (e.g. via `git push` or a pull from a fork). There was previously no way to start an evolve session on one of these pre-existing branches — the evolve flow always created a new branch as part of setup. This change closes that gap, letting any evolver kick off the full AI-powered preview pipeline on any existing local branch with a single click.
