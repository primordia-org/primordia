# Fix branch name wrapping on small screens

## What changed
In `ChatInterface.tsx`, the `<h1>` that displays "Primordia" alongside the current branch name now uses `flex-wrap` instead of a single‑row flex layout. The branch name span also gets `w-full sm:w-auto`, so on small viewports it occupies its own row while on `sm` and wider screens it stays inline as before.

## Why
On narrow screens (e.g. mobile), a long branch name like `claude/issue-77-20260320-0428` caused the heading row to overflow horizontally, pushing the Chat/Evolve mode‑toggle buttons off the right edge of the screen and requiring horizontal scrolling to reach them. Wrapping the branch name to its own row on small screens keeps the toggle always visible without affecting the desktop layout.
