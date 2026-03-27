# Clean up merged branch worktree and git config on accept or reject

## What changed

In `app/api/evolve/local/manage/route.ts`, both the **accept** and **reject** flows now call:

```
git config --remove-section branch.<name>
```

after removing the worktree and deleting the branch.

## Why

When the local evolve flow creates a worktree for a preview branch it writes a custom git config entry:

```
branch.<branchName>.parent = <parentBranch>
```

This entry tells the preview server's manage endpoint which branch to merge back into. Previously, when the branch was accepted (merged) or rejected, the worktree directory and git branch were deleted — but this config section was **never removed**.

The orphaned `branch.<name>.parent` entries accumulated in `.git/config`, and because the branches page uses these entries to build the branch tree, the stale config could cause confusing diagnostics. More importantly, leaving dead config sections is simply incorrect hygiene: the branch and its worktree no longer exist, so all associated config should be cleaned up at the same time.

The `--remove-section` flag is used rather than `--unset` on the individual key so that any other per-branch config entries written in future are also swept up automatically. Git exits with code 1 when the section is absent; that exit code is intentionally ignored (the section might already be gone if something cleaned it up externally).
