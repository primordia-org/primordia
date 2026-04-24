# Worktree-aware main branch advancement

## What changed

`moveMainAndPush` in `app/api/evolve/manage/route.ts` now checks whether the
`main` branch is currently checked out in any git worktree before deciding how
to advance the pointer.

**New behaviour:**

- **`main` is checked out in a worktree** → `git reset --hard <sha>` is run
  inside that worktree directory. This updates the branch ref *and* the working
  tree/index atomically, keeping the checkout consistent.
- **`main` is not checked out anywhere** → `git update-ref refs/heads/main
  <sha>` is used directly. This is the safe, low-level approach that works
  without any working tree.

A new helper function `findWorktreeForBranch` was extracted to parse
`git worktree list --porcelain` output and return the directory path for a given
branch name (or `null` if none has it checked out).

## Why

Previously the code always used `git update-ref` followed by
`git checkout --force main`, even when `main` was already checked out in a
worktree. Using `git update-ref` moves the ref underneath an existing checkout,
leaving the working tree stale (pointing to the old commit) until the checkout
command ran. Using `git reset --hard` in the worktree where `main` lives is the
correct primitive: it advances the ref and syncs the working tree in one atomic
step, which is what git expects when a branch is checked out.
