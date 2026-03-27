# Use force-delete for preview branch on Accept

## What changed

In `app/api/evolve/local/manage/route.ts`, the Accept flow now uses `git branch -D` (force delete) instead of `git branch -d` (safe delete) when removing the preview branch after a successful merge.

## Why

After the merge is complete, `git branch -d` checks whether the branch tip is reachable from the repository's current `HEAD`. In a worktree setup, `HEAD` may point to a completely different branch than `parentBranch` — the merge lands on `parentBranch` but that doesn't make the branch reachable from `HEAD`. Git conservatively refuses the delete with "error: The branch '…' is not fully merged."

The Reject flow already used `git branch -D` for the same reason (a rejected branch is never merged anywhere). Aligning Accept to also use `-D` is safe here because we only reach that line after the merge has already succeeded, so the work is preserved on `parentBranch`.

The comment above the call was updated to explain the reasoning.
