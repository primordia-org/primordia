# Add animated changelog newsticker to landing page

## What changed

- Added a `ChangelogNewsticker` server component (`app/ChangelogNewsticker.tsx`) that reads the 12 most-recent changelog entries at request time and renders a continuously-scrolling horizontal ticker strip across the top of the landing page, directly below the `LandingNav`.
- Each headline in the ticker is a link to `/changelog#<slug>` — clicking it opens the changelog page scrolled to that specific entry.
- Hovering anywhere on the ticker pauses the animation (CSS `animation-play-state: paused`).
- Soft fade-gradient edges mask the overflow on left/right so the strip looks clean at all viewport widths.
- A static "UPDATES" badge sits to the left of the strip as a label.
- Added `@keyframes ticker-scroll` and `.animate-ticker` (plus `prefers-reduced-motion` suppression) to `app/globals.css`.
- Exported a `changelogEntrySlug()` helper from the new component; re-used in `app/changelog/page.tsx` to add matching `id` attributes to each `<li>` so the hash anchors work.

## Why

Visitors to the landing page had no way to see recent activity without navigating away. The newsticker provides a live, low-distraction signal that the project is actively evolving and lets curious visitors jump straight to the details of any recent change.
