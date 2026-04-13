# Checkout `main` in `~/primordia` after prod deploy

## What changed

Added a `git checkout main` step at the end of `moveMainAndPush` in
`app/api/evolve/manage/route.ts`. After the `main` branch pointer is
force-moved to the accepted session branch and pushed to the remote, the
main repo checkout at `~/primordia` now switches to `main` so it reflects
the latest production code.

The step is non-fatal: a failure is logged as a warning (`⚠`) and does not
block the deploy from completing.

## Why

`~/primordia` is the primary git repo (all worktrees share its `.git`). It
was sitting on a detached HEAD or an old branch even after `main` was updated.
Checking out `main` there keeps it up to date so tools and scripts that rely
on the working tree at `~/primordia` always see the current production code.
