# Remove Rebase Option, Rename Merge to "Apply Updates"

## What changed

- The "Rebase" button in the Upstream Changes panel on the session page has been removed.
- The "Merge" button has been renamed to **"Apply Updates"**.
- Loading state text updated from "Merging…" to "Applying…".
- The `/api/evolve/upstream-sync` route now only accepts `action: "merge"` (rebase path removed).

## Why

Offering both Merge and Rebase created unnecessary UX complexity. Rebase rewrites history, which can cause confusion when multiple people are working on or reviewing the same session branch. Merge is the safe default that preserves history and is less likely to cause surprises. "Apply Updates" is a more user-friendly label that describes what the action does without exposing git terminology.
