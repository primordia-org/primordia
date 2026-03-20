# Move evolve mode to its own page

## What changed

- **Removed** the `ModeToggle` component ("Chat" / "Evolve" toggle buttons in the header).
- **Replaced** the toggle with a small pencil (Edit) icon button in the chat header that links to `/evolve`.
- **Created** `app/evolve/page.tsx` — a dedicated Next.js route for submitting evolve requests.
- **Created** `components/EvolveForm.tsx` — a new "submit a request" form component containing all evolve-specific logic (formerly embedded in `ChatInterface`).
- **Simplified** `ChatInterface.tsx` — now handles chat only; all evolve state, handlers, and UI have been removed.

## Why

The previous design treated Chat and Evolve as two modes of the same interface, toggled by a button in the header. This was conceptually muddled — they serve very different purposes. Chat is the main app; Evolve is a utility for proposing code changes to the app itself.

The new design makes the distinction clear:
- `/` (Chat) is the landing page and primary experience.
- `/evolve` is a separate "submit a request" form, reached by clicking the pencil icon.

This mirrors familiar patterns (e.g., GitHub's "New Issue" form is separate from the issues list), reduces clutter in the chat header, and makes the evolve flow feel intentional rather than accidental.
