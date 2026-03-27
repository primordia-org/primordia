# Drop `evolve/` prefix from branch names

## What changed

- `app/api/evolve/local/route.ts`: `findUniqueBranch` now produces plain `{slug}` branch names instead of `evolve/{slug}`. The `sessionId` variable was previously derived by stripping the `evolve/` prefix off the branch name; now it is just the branch name directly (they are the same thing).
- `PRIMORDIA.md`: Updated the local evolve data-flow description to reflect the new branch naming (no `evolve/` prefix).

## Why

Almost all development on Primordia is done by Primordia itself, so every branch already belonged to the evolve pipeline. The `evolve/` prefix was adding visual noise to branch listings without providing meaningful disambiguation. Removing it keeps branch names shorter and cleaner in the git log, GitHub UI, and worktree paths.
