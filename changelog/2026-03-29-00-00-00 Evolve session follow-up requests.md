# Evolve session follow-up requests

## What changed

Evolve sessions can now be iterated on with one or more follow-up requests, turning a single "submit and wait" flow into a conversation-style chain of improvements.

### New UI: "Submit a follow-up request" form

A form now appears at the bottom of the session page (`/evolve/session/[id]`) whenever the session is in the **ready** state (Claude has finished and the preview server is running). The form includes:

- A descriptive heading and helper text explaining the use case (e.g. "I got this error when using it:" or "please change the design of the button")
- A resizable textarea for the follow-up description
- A submit button (disabled while submitting or while the textarea is empty)
- Inline error display if the API call fails

On submission the UI immediately transitions back to `running-claude` (hiding the form and resuming the polling loop), then returns to `ready` when Claude finishes.

### New API route: `POST /api/evolve/local/followup`

`app/api/evolve/local/followup/route.ts` accepts `{ sessionId, request }` and:

1. Validates auth and `NODE_ENV === 'development'`
2. Reads the session from SQLite; returns 400 if it isn't in `ready` state
3. Immediately writes `running-claude` to DB so the polling client sees the change
4. Calls `runFollowupInWorktree` fire-and-forget (same pattern as the original `startLocalEvolve`)

### New function: `runFollowupInWorktree`

Added to `lib/local-evolve-sessions.ts`. Runs a follow-up Claude Code pass inside the **existing worktree** without creating a new branch, running `bun install`, or restarting the dev server. Key behaviours:

- Appends a `---` separator and `### 🔄 Follow-up Request` section header to `progressText` so the history of requests is clearly readable in the session page
- Uses the same worktree boundary hook so Claude can't accidentally touch the main repo
- The prompt instructs Claude to **update the most recent changelog file** in `changelog/` rather than creating a new one, since the follow-up extends the same branch's changes
- On success: appends ✅ message and sets status back to `ready`
- On error: appends ❌ message and sets status to `error`

### Polling improvements in `EvolveSessionView`

The `setInterval` block was extracted into a plain `startPolling()` function so it can be called both from the mount `useEffect` and from the follow-up submit handler (to resume polling after the status is reset to `running-claude`).

## Why

The original evolve flow only supported a single round-trip: one request → one Claude run → accept or reject. In practice users often need to iterate: trying a new feature reveals a bug, or the first attempt has the right functionality but wrong copy or visual design. Follow-up requests let users stay on the same branch and have Claude address that feedback without starting a whole new session (which would create a new branch and a separate changelog entry).
