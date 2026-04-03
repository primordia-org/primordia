# Evolve form as floating draggable dialog

## What changed

"Propose a change" in the hamburger menu now opens a draggable, dockable floating dialog instead of navigating to the `/evolve` page.

### New component: `FloatingEvolveDialog`

- Fixed-position overlay containing the evolve request form (textarea, file attachments, submit button)
- **Draggable**: click and drag the title bar to freely reposition the dialog anywhere on screen
- **Dockable**: four corner buttons in the title bar snap the dialog to any viewport corner (top-left, top-right, bottom-left, bottom-right); defaults to bottom-right
- Submits to `POST /api/evolve` and navigates to `/evolve/session/{id}` on success — same flow as the full page form

### Updated: `HamburgerMenu` / `buildStandardMenuItems`

Added optional `onEvolveClick` parameter. When provided, the "Propose a change" item renders as a button (calls the callback) instead of a link to `/evolve`. Backwards compatible — callers that don't pass `onEvolveClick` continue to get the link behaviour.

### Updated: `ChatInterface`, `PageNavBar`, `EvolveSessionView`

All three now pass `onEvolveClick: () => setEvolveDialogOpen(true)` to `buildStandardMenuItems` and conditionally render `<FloatingEvolveDialog>`.

### `/evolve` page unchanged

The dedicated `/evolve` page and `EvolveForm` component are untouched. The page is still reachable directly and `EvolveForm` continues to filter out the "Propose a change" menu item when `currentPath === "/evolve"`.

## Why

The user wanted to reference the current page (e.g., look at the chat, or see a bug in the UI) while writing their evolve request, which was impossible when clicking "Propose a change" navigated away from that page. A floating dialog that can be moved or docked to a corner lets the user keep the page visible while composing their request.
