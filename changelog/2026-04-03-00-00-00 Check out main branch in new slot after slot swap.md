# Check out main branch in new slot after slot swap

## What changed

In the blue/green accept flow (`app/api/evolve/manage/route.ts`), after the slot swap and session branch deletion, a new Step 7b was added that runs `git checkout <parentBranch>` inside the new production worktree.

## Why

Previously, the new slot was left with a **detached HEAD** pointing at the merge commit. This was intentional up to that point — the HEAD had to be detached so that the session branch could be deleted in Step 7. But after the branch was deleted there was no follow-up to re-attach HEAD.

A detached HEAD breaks any logic that reads the current branch name from git (e.g. `page-title.ts` for the branch/port suffix, the `/branches` diagnostics page, and any future branch-detection code). In production the slot should look like a normal `main` checkout, not a detached commit.

The fix: immediately after deleting the session branch, run `git checkout main` (or whatever the parent branch is) in the new worktree. The tree content is identical — this just moves `HEAD` from a detached ref to the named branch pointer.
