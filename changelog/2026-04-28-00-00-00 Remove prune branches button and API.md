# Remove Prune Branches Button and API

## What changed

- Removed the "Delete merged" (`PruneBranchesButton`) button from the `/branches` admin actions row.
- Deleted the `PruneBranchesButton.tsx`, `PruneBranchesDialog.tsx`, and `StreamingDialog.tsx` components from `app/branches/`.
- Deleted the `app/api/prune-branches/route.ts` API route that performed the branch deletion.
- Cleaned up the import and render of `PruneBranchesButton` in `app/branches/page.tsx`.
- Updated `AGENTS.md` to remove references to these deleted files.

## Why

The "Delete merged branches" feature was removed per user request. The button and its backing API are no longer needed.
