# Remove stale PROD symbolic-ref mention from accept dialog

## What changed

Updated the accept confirmation copy in `components/EvolveSessionView.tsx` to remove the outdated reference to the `PROD` git symbolic-ref. The text previously said:

> "The `PROD` symbolic-ref will switch to `refs/heads/{sessionBranch}`"

It now says:

> "`primordia.productionBranch` in git config will be updated to `{sessionBranch}`"

## Why

The `PROD` symbolic-ref was replaced by `primordia.productionBranch` in git config (see changelog entry from 2026-04-09). The UI text was never updated to reflect that change, leaving users with an inaccurate description of how production routing works.
