# Show restart dev server button in error state

## What changed

Added a "Restart dev server" button to the error state panel in `EvolveSessionView` when the dev server is in `starting` or `running` state.

Previously the button only appeared when the session was in `ready` state (in the dev server status panel) or when `devServerStatus === "disconnected"` (in the disconnected notice). If a session entered `error` state while the dev server was still starting or running (e.g. because turbopack caused an error during startup), there was no way to restart the server from the UI.

## Why

The `enable-turbopack` session hit an error — the dev server was in `starting` state at the time, so the session transitioned to `error`. The restart button was hidden because its render conditions only checked for `status === "ready"`. Users need to be able to restart the dev server from the error state to recover without having to navigate away.
