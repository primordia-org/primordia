# Add session links to branches page

## What changed

On the `/branches` page, evolve sessions are now linked to their session-tracking pages in two places:

1. **Branch tree** — any branch with a corresponding evolve session shows a **"session ↗"** link (in purple) next to the branch name, navigating to `/evolve/session/{id}`.
2. **Diagnostics table** — the truncated session ID in the diagnostics `<details>` panel is also a clickable purple link to `/evolve/session/{id}`, making it easy to jump to a session directly from the diagnostics view.

### Implementation details

- Added `sessionId: string | null` to the `BranchData` interface so the session ID flows through to the render layer.
- Populated `sessionId` from the SQLite `evolve_sessions` lookup already performed in `getBranchData()` (no extra DB query needed).
- In `BranchRow`, rendered a `<Link>` to `/evolve/session/{sessionId}` whenever `sessionId` is present, styled in purple to visually distinguish it from the blue preview-server link.
- In the diagnostics table, wrapped the `{s.id.slice(0, 8)}…` cell content in a `<Link>` to `/evolve/session/{s.id}` (same purple styling).
- Updated the legend at the bottom of the page to explain the purple link.

## Why

Previously, the branches page showed the status and preview URL for sessions but gave no way to navigate to the full session log from either the branch tree or the diagnostics panel. Adding direct links in both places makes it easy to jump from any part of the branches overview to a session detail page without manually constructing the URL.
