# Fix git worktree error message regex for newer git versions

## What changed

Updated the regex in `app/api/evolve/local/manage/route.ts` that parses the path
from a failed `git checkout` when the target branch is already checked out in
another worktree.

**Before:**
```
/already checked out at '([^']+)'/
```

**After:**
```
/(?:already checked out at|already used by worktree at) '([^']+)'/
```

## Why

Different versions of git emit slightly different error messages for this
condition:

- Older git: `fatal: 'branch' is already checked out at '/path/to/worktree'`
- Newer git: `fatal: 'branch' is already used by worktree at '/path/to/worktree'`

The original regex only matched the older form. When running a newer git version
the regex would fail to match, causing the accept action to return a 500 error
instead of gracefully falling back to running the merge in the correct existing
worktree.

The fix uses a non-capturing alternation `(?:already checked out at|already used
by worktree at)` so both message variants are handled, while still capturing the
worktree path in group 1.
