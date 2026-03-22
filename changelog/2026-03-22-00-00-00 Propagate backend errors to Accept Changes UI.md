# Propagate backend errors to Accept Changes UI

## What changed

In `components/AcceptRejectBar.tsx`, all four action handlers (`handlePreviewAccept`, `handlePreviewReject`, `handleVercelAccept`, `handleVercelReject`) had empty `catch {}` blocks that silently swallowed errors and reset the button state to `"idle"`. When a backend error occurred (e.g. a git merge conflict, missing env vars, GitHub API failure), the button would just appear to do nothing — no feedback whatsoever.

### Changes made:

1. **Added `errorMessage` state** (`useState<string | null>(null)`) to track the latest error.
2. **Updated all four catch blocks** to capture the error message (`err instanceof Error ? err.message : String(err)`) and store it in `errorMessage`, so it's visible to the user.
3. **Cleared `errorMessage` at the start of each action** so stale errors don't linger when retrying.
4. **Added an error banner** at the bottom of the bar that displays the error message with a dismiss (✕) button. The banner uses `whitespace-pre-wrap` so multi-line git error output (e.g. merge conflict details) renders readably.

## Why

The user reported that clicking "Accept Changes" appeared to do nothing — no success, no error. The root cause was that backend errors (from `/api/evolve/local/manage` or `/api/merge-pr`) were thrown in the `try` block but caught and discarded without ever surfacing to the UI. Now errors are always shown so the user knows what went wrong and can take action (e.g. resolve a conflict, fix configuration).
