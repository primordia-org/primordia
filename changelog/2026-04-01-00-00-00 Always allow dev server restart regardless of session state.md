# Always allow dev server restart regardless of session state

## What changed

- Removed the `status !== 'ready'` guard from `POST /api/evolve/kill-restart`. The route previously rejected restart requests with a confusing error ("Can only restart a session that is ready") if the session was in any state other than `ready` (e.g. `error`). Now the endpoint accepts restart requests for any session state.
- Updated the error-state panel in `EvolveSessionView.tsx` to always show the "↺ Restart dev server" button, regardless of `devServerStatus`. Previously the button was hidden unless the dev server happened to already be in a `running` or `starting` state, making it unreachable in the most common error recovery scenario.

## Why

The restart button is useful precisely when things have gone wrong — i.e. when the session is in an `error` state. Blocking restarts to `ready`-only sessions made the feature much less useful. The underlying `restartDevServerInWorktree` function already handles all edge cases (null port, missing processes) gracefully, so there was no technical reason for the restriction.
