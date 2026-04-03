# Add progress feedback during Accept flow

## What changed

When a user clicks Accept on a session, the merge process (type-check → build → dependency install → health check → slot swap → service restart) can take 1–2+ minutes. Previously the UI showed only a loading spinner on the button with no indication of which step was running.

### Server (`app/api/evolve/manage/route.ts`)

- The POST handler for `action: "accept"` now runs gates 1 & 2 (ancestor check, clean worktree) synchronously as before, then immediately:
  1. Marks the session status as `"accepting"` in the DB.
  2. Appends a `### 🚀 Merging into <branch>` section header to `progressText`.
  3. Fires the remaining work (`runAcceptAsync`) asynchronously.
  4. Returns `{ outcome: "accepting" }` so the client can start streaming immediately.
- New `runAcceptAsync` function contains the moved logic for gates 3+4 and the merge step, writing one-line step labels (`- Type-checking…`, `- Building for production…`, etc.) to `progressText` before each stage begins.
- New `appendToProgress` helper does an atomic read-modify-write on just the `progressText` field, used by `runAcceptAsync`, `blueGreenAccept`, and `retryAcceptAfterFix`.
- `blueGreenAccept` gains an optional `onStep` callback that is called before the slow steps: dependency install, health check, slot activation, and service restart.
- `retryAcceptAfterFix` (the auto-fix retry path) also logs step labels (`- Re-checking TypeScript types…`, `- Re-building for production…`, `- Merging branch…`, `- Installing dependencies…`) so the user sees progress there too.

### Client (`components/EvolveSessionView.tsx`)

- `handleAccept` now handles `outcome: "accepting"` from the server by setting `status` to `"accepting"` and starting SSE streaming, so the step lines appear in the progress log as they are written.
- The Available Actions panel shows an "Accepting changes… ⟳" spinner (green) when `status === "accepting"`, replacing the action buttons while the merge is in progress. This mirrors the existing "Fixing type errors…" indicator.

## Why

Users experienced anxiety that the Accept button was "stuck" during the production build and health-check steps, since those can easily take over a minute with no feedback. The progress lines stream in via the existing SSE mechanism so no new infrastructure was needed.
