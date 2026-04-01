# Add pre-accept gates to prevent broken merges

## What changed

Three safety gates were added to `POST /api/evolve/manage` before a session branch is merged into its parent branch:

1. **Up-to-date check** — `git merge-base --is-ancestor <parentBranch> HEAD` is run in the session worktree. If the parent branch has commits that are not yet in the session branch, the accept is blocked with a clear message directing the user to the Merge/Rebase button on the session page.

2. **Clean worktree check** — `git status --porcelain` is run in the session worktree. If there are any uncommitted changes (staged or unstaged), the accept is blocked and the dirty files are listed in the error.

3. **TypeScript type check** — `bun run typecheck` (`tsc --noEmit`) is run in the session worktree. If any type errors are present, a follow-up request is automatically started in the worktree with the compiler output as context, instructing Claude Code to fix all type errors without changing runtime behaviour. The session transitions to a new dedicated `fixing-types` status (distinct from `running-claude`) which keeps the **Available Actions** panel visible on the session page throughout the fix. Live progress streams into the progress area as usual. When Claude finishes, the session returns to `ready` and the session page automatically retries the Accept — no user action required.

Only when all three gates pass does the flow proceed to check out the parent branch and merge.

A small `runCmd` helper (analogous to the existing `runGit`) was added to `manage/route.ts` to support spawning non-git commands asynchronously.

## Why

Two concurrent evolve sessions were merged into `main` without conflict markers, but one session had renamed a file while the other added an import using the old filename. Git detected no merge conflict (it was a rename vs. a new import in different files), so the broken code reached production and required a manual SSH fix.

These gates make it structurally impossible to accept a session that:
- diverged from its parent without first integrating the parent's latest changes,
- has uncommitted work that wasn't reviewed as part of the session, or
- introduces TypeScript errors.
