# Auto-stash local changes before Accept merge

## What changed

Modified `app/api/evolve/local/manage/route.ts` to automatically stash any uncommitted
local changes in the parent repo before performing the merge on "Accept Changes", then
restore them afterwards with `git stash pop`.

## Why

When the parent repo had uncommitted changes to tracked files (e.g. `package.json`), git
would refuse the merge with:

```
error: Your local changes to the following files would be overwritten by merge:
	package.json
Please commit your changes or stash them before you merge.
Aborting
Merge with strategy ort failed.
```

This caused the Accept Changes button to fail with a 500 error even though the preview
branch itself was perfectly valid.

## How it works

1. Before merging, run `git status --porcelain` in `mergeRoot` to detect any dirty working tree.
2. If dirty, run `git stash push -u -m primordia-auto-stash-before-merge` to stash all
   tracked and untracked changes.
3. Run `git merge` as before.
4. If the merge **fails** for any other reason, pop the stash to restore the original state
   before returning the error.
5. If the merge **succeeds**, pop the stash to restore the local changes on top of the
   merge result.
6. If `stash pop` itself produces a conflict (rare — only possible if the evolve branch
   touched the same file the user had locally modified), the merge still succeeds and a
   `stashWarning` field is included in the JSON response so the user can see they need to
   resolve the stash manually.
