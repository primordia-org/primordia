# Fix prune-branches parsing of worktree branches

## What changed

Updated the branch-name parsing regex in `app/api/prune-branches/route.ts` from `/^\*?\s+/` to `/^[*+]?\s+/`.

## Why

`git branch --merged main` uses two different prefix characters:

- `* branch` — the branch currently checked out in the **current** worktree
- `+ branch` — a branch checked out in **another** worktree (e.g. a local evolve preview worktree)
- `  branch` — a normal (not checked-out) branch

The old regex only stripped the `*` marker, so when `main` was checked out in a different worktree the line appeared as `+ main`. The `+` was not stripped, the resulting string was `+ main` rather than `main`, and the `.filter((name) => name !== 'main')` guard did not exclude it. The code then tried to delete a branch literally named `+ main`, which does not exist, producing the error:

```
error: branch '+ main' not found
```

The fix adds `+` to the character class (`[*+]?`) so both prefix styles are stripped before the name is compared or passed to `git branch -d`.
