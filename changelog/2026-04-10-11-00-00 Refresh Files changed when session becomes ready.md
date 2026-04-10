# Refresh "Files changed" when session status becomes ready

## What changed

- Added `GET /api/evolve/diff-summary?sessionId=...` — a new API route that returns the per-file numstat summary (additions + deletions per file) for a session branch vs its parent. Uses the same `git diff --numstat -w parent...branch` logic as the server-side `getGitDiffSummary()` in the session page.
- In `EvolveSessionView`, `diffSummary` is now tracked as local state (`liveDiffSummary`) initialised from the server-rendered prop.
- A `useEffect` watching `status` fires a fetch to `/api/evolve/diff-summary` whenever the status transitions to `"ready"`, updating `liveDiffSummary` with the latest git diff data.

## Why

Previously the "Files changed" section was only populated from the initial server render of the session page. If the user was already on the session page when Claude finished and the status transitioned to `"ready"` via the SSE stream, no diff was shown — because the page hadn't reloaded and the initial render (before Claude committed anything) returned an empty diff. Now the diff is fetched live when the session becomes ready, so it always reflects the actual commits Claude made.
