# Move main branch pointer on prod accept

## What changed

During the production blue/green accept flow, after the reverse proxy successfully
spawns the new production server, the `main` branch ref is now force-moved to point
at the accepted session branch's HEAD commit, then pushed to the remote.

This applies to both the normal accept path (`runAcceptAsync`) and the auto-fix
retry path (`retryAcceptAfterFix`).

A new `moveMainAndPush` helper handles the two-step operation:

1. `git branch -f main <session-branch>` — advances the local `main` pointer
2. `git push [remote] main:main` — pushes to the remote (uses `GITHUB_TOKEN` +
   `GITHUB_REPO` for an authenticated HTTPS URL when both env vars are set,
   otherwise falls back to `git push origin main`)

Both steps are non-fatal: failures are logged as warnings (`⚠`) in the session
progress log so a remote push failure never blocks a deploy from completing.

## Why

`main` is a stable, well-known branch that external users and tools clone to get
the latest version of Primordia. Before this change, accepting an evolve session
only swapped the live production slot via the reverse proxy — `main` was never
updated, so cloners would always see stale code. Now every accepted deploy
automatically keeps `main` in sync with production.
