# Stream session page Claude logs via SSE

## What changed

The evolve session page previously loaded live Claude Code progress by polling
`GET /api/evolve?sessionId=...` every **5 seconds**. This meant users could wait
up to 5 s to see the next line of output appear.

The page now uses Server-Sent Events (SSE) instead:

- **New route** — `GET /api/evolve/stream?sessionId=<id>&offset=<n>` polls
  SQLite every **500 ms**, computes the delta since the last send, and pushes a
  JSON SSE event containing `{ progressDelta, status, devServerStatus, previewUrl }`.
  The stream closes automatically when the session reaches a terminal state
  (`accepted`, `rejected`, `error`, or `ready` + dev server up/disconnected).
  Client disconnection (via `request.signal`) wakes the sleep early so the loop
  exits without delay.

- **Client update** — `EvolveSessionView` replaces its `setInterval` polling
  loop with a `fetch`-based SSE reader (the same pattern used by
  `StreamingDialog`). It passes `offset = progressText.length` so the server
  sends only new text, avoiding duplication of the initial state already
  delivered by the server component. An `AbortController` stops the stream on
  unmount or when a follow-up / server-restart reconnects.

## Why

Users were waiting up to 5 seconds between each visible update while Claude Code
was actively writing files. SSE at 500 ms gives near-real-time feedback,
consistent with how the rest of the app (chat, git-sync, prune-branches) already
streams progress.
