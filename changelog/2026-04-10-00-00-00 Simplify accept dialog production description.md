# Simplify accept dialog production description

## What changed

The production accept confirmation message in `EvolveSessionView.tsx` was simplified from a verbose multi-sentence explanation to a concise two-sentence summary.

**Before:**
> Accepting will make `{sessionBranch}` the new live production instance. No merge commit is created — `{parentBranch}` stays at its current commit so the previous slot can be rolled back to. `primordia.productionBranch` in git config will be updated to `{sessionBranch}`, and the reverse proxy will cut traffic over with no downtime. The previous production worktree stays registered for rollback.

**After:**
> Accepting will deploy `{sessionBranch}` to production with zero-downtime cutover. `{branch}` stays registered for rollback.

## Why

The old message was overly technical and repeated information that is either implied or not relevant to a user confirming an action. The new version conveys the two things users care about: what happens (zero-downtime deploy) and that they can roll back if needed.
