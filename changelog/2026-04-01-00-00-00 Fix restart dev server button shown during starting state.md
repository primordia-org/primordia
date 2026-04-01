# Fix restart dev server button shown during starting state

## What changed

### Restart button visibility
In `components/EvolveSessionView.tsx`, the "Restart dev server" button inside the
`status === "ready"` panel was shown unconditionally — including when
`devServerStatus === "starting"`. Offering a restart while the server is already
spinning up is confusing and redundant.

- The restart button is now hidden when `devServerStatus === "starting"`.
- The current `devServerStatus` value is always displayed as a label in the panel
  (e.g. `none`, `starting`, `running`, `disconnected`) so the user can see exactly
  what state Primordia thinks the dev server is in.

### Fix: restart sets session to error state instead of running
In `lib/local-evolve-sessions.ts`, `restartDevServerInWorktree` reset `session.port`
to `null` but did not reset `session.previewUrl`. The promise that waits for the
server to become ready checks `!session.previewUrl` before resolving — so with a
stale `previewUrl` still set, the check never passed. The promise waited until the
2-minute timeout fired, which then caught the timeout error and set
`session.status = 'error'`.

Fixed by also resetting `session.previewUrl = null` (alongside `session.port = null`)
at the start of `restartDevServerInWorktree`.

## Why

The user clicked the restart button and observed: starting state → none state → error
state, causing the session panel to disappear. The root cause was the stale
`previewUrl` preventing the ready-detection logic from ever resolving the promise.
