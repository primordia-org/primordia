# Add session links to branches page

## What changed

On the `/branches` page, any branch that has a corresponding evolve session now shows a **"session ↗"** link (in purple) next to the branch name. Clicking it navigates to `/evolve/session/{id}` — the session-tracking page for that branch.

### Implementation details

- Added `sessionId: string | null` to the `BranchData` interface so the session ID flows through to the render layer.
- Populated `sessionId` from the SQLite `evolve_sessions` lookup already performed in `getBranchData()` (no extra DB query needed).
- In `BranchRow`, rendered a `<Link>` to `/evolve/session/{sessionId}` whenever `sessionId` is present, styled in purple to visually distinguish it from the blue preview-server link.
- Updated the legend at the bottom of the page to explain the new purple link.

## Why

Previously, the branches page showed the status and preview URL for sessions but gave no way to navigate to the full session log. Adding a direct link makes it easy to jump from branch overview to session detail without having to manually construct the URL.
