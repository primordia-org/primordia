# Run `bun install --frozen-lockfile` after Accept merge

## What changed

After a user clicks **Accept Changes** on an evolve session, Primordia now runs
`bun install --frozen-lockfile` in the parent branch directory immediately after
the git merge completes.

This applies in two code paths inside `app/api/evolve/manage/route.ts`:

1. **Normal accept** (`POST /api/evolve/manage` with `action: "accept"`) — runs
   after the merge (and optional stash-pop) succeeds, before the session is
   marked `accepted` in the database.
2. **Auto-fix accept** (`retryAcceptAfterFix`) — same position: after the merge
   and stash-pop, before the session is marked `accepted`.

If `bun install --frozen-lockfile` exits non-zero (i.e. the lockfile is out of
sync with `package.json`), the accept is aborted and an error is returned so the
problem surfaces clearly rather than leaving the running server with stale or
missing dependencies.

## Why

When an evolve branch adds or upgrades npm packages, the `package.json` and
`bun.lockb` in the worktree are updated, but the *parent* branch's
`node_modules` still reflect the old state. After merging, the parent server
would try to import modules that haven't been installed yet, causing runtime
crashes. Running `bun install --frozen-lockfile` right after the merge ensures
`node_modules` is consistent with the freshly-merged lockfile.

Using `--frozen-lockfile` (rather than a plain `bun install`) intentionally
fails fast if the lockfile isn't up to date — surfacing a developer mistake
(changing `package.json` without regenerating the lockfile) rather than silently
drifting.
