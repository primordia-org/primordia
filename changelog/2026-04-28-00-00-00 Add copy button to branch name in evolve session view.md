# Add copy button to branch name in evolve session view

## What changed

Added a right-aligned Copy icon button to the branch name in the "Created branch" card on the evolve session page (`EvolveSessionView.tsx`).

- Introduced a small `CopyBranchName` component that wraps the branch `<code>` element in a flex row with the copy button pinned to the right.
- Clicking the button copies the branch name to the clipboard via `navigator.clipboard.writeText`.
- The icon switches to a `Check` (✓) for 2 seconds after a successful copy to give visual confirmation, then reverts to the `Copy` icon.
- Uses `Copy` and `Check` icons from `lucide-react` (already a project dependency).

## Why

When working with a session branch it is common to need the branch name in a terminal (e.g. `git checkout`, `git push`). Previously the name was only displayed as plain text and had to be manually selected and copied. The one-click copy button removes that friction.
