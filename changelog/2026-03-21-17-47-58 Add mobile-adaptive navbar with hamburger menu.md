# Add mobile-adaptive navbar with hamburger menu

## What changed

The header of the main chat UI (`components/ChatInterface.tsx`) was redesigned to use a standard hamburger (☰) menu pattern instead of always-visible icon buttons.

### Before
- Two icon-only buttons sat in the header at all times: a cloud-upload icon (Sync) and a pencil icon (Edit/Evolve).
- On narrow mobile screens these competed for space with the title and branch name.

### After
- A single hamburger button (☰) replaces the two icon buttons.
- Tapping/clicking it toggles a dropdown menu anchored to the top-right of the header.
- The dropdown contains two clearly-labelled items with icons:
  - **Propose a change** (pencil icon) → navigates to `/evolve`
  - **Sync with GitHub** (cloud-upload icon) → opens the `GitSyncDialog` modal
- The button switches to an ✕ icon while the menu is open for clear affordance.
- Clicking outside the dropdown closes it (via a `mousedown` listener that is only attached while the menu is open).
- The welcome message was updated to reference the ☰ menu rather than the old ✏️ button.
- The top-of-file comment block was updated to document the new behaviour.

## Why

The original two-button layout was functional but cluttered the header, especially on mobile where horizontal space is limited. Moving the actions into a hamburger dropdown is a well-understood mobile navigation pattern that keeps the header clean while remaining fully accessible — all items are keyboard-navigable links or buttons with clear labels.
