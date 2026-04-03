# Check out main branch in new slot after slot swap

## What changed

In the blue/green accept flow (`app/api/evolve/manage/route.ts`), after the slot swap and session branch deletion, a new Step 7b was added that runs `git checkout <parentBranch>` inside the new production worktree.

To make this work, a Step 7b-prep was also added: before checking out the parent branch in the new slot, HEAD in the **old slot** (now `previous`) is detached via `git checkout --detach`. This is required because git forbids two worktrees from having the same branch checked out simultaneously.

The rollback route (`app/api/rollback/route.ts`) was updated with the same logic in reverse: after swapping `current` ↔ `previous`, HEAD is detached in the slot that just became `previous` (which has the branch checked out), and then the branch is re-checked-out in the slot that just became `current` (which has a detached HEAD from the accept flow).

## Why

Previously, the new slot was left with a **detached HEAD** pointing at the merge commit. This was intentional up to that point — the HEAD had to be detached so that the session branch could be deleted in Step 7. But after the branch was deleted there was no follow-up to re-attach HEAD.

A detached HEAD breaks any logic that reads the current branch name from git (e.g. `page-title.ts` for the branch/port suffix, the `/branches` diagnostics page, and any future branch-detection code). In production the slot should look like a normal `main` checkout, not a detached commit.

The initial fix (`git checkout main` in the new worktree) would have failed silently because the old production slot still had `main` checked out. The two-step approach (detach old → checkout in new) is necessary because git enforces single-worktree-per-branch at the git level, not just as a convention.

The same issue applies in reverse during rollback: the rolled-back slot has detached HEAD (left by the accept flow), so the rollback route now re-attaches it after detaching the retiring slot.
