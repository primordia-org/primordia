# Resume SSE stream on tab focus

## What changed

Added a `visibilitychange` event listener in `EvolveSessionView` that reconnects
the SSE progress stream whenever the tab or app regains focus.

## Why

On mobile, browsers typically suspend background tabs and pause network
connections (including SSE streams). When a user switches away from the session
page and comes back, the stream had silently stopped — leaving the UI frozen on
stale progress until a manual reload.

Now, when `document.visibilityState` transitions back to `"visible"`, the
component checks whether the session is still in a non-terminal state and, if so,
calls `startStreaming()`. That function already handles aborting any stale/dead
stream and uses `progressLengthRef` to request only the delta since the last
received byte, so no progress is duplicated or lost.

Two mirror refs (`statusRef`, `devServerStatusRef`) are kept in sync with the
corresponding state values so the listener always reads the current session state
without needing to be re-registered on every render.
