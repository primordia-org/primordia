# Responsive mobile layout for session action panel

## What changed

### Submit button overflow — flex-wrap with full-width fallback

The action row below the textarea in `EvolveRequestForm` now uses `flex-wrap` so that when the submit button's label is long (e.g. "Waiting for Pi (Claude Sonnet 4.6) to finish…"), the button wraps onto its own second row rather than overflowing the container:

- **Mobile:** submit button goes full-width (`w-full`) on the second row when it wraps, keeping everything readable and tappable
- **Desktop (`sm+`):** restored to `w-auto` — all items stay on one row as before
- Compact mode (floating dialog) is unaffected; it keeps its existing single-row layout

## Why

A user screenshot showed the submit button visually cut off on a ~400px-wide Android screen when the disabled label was long (e.g. while an agent was running).
