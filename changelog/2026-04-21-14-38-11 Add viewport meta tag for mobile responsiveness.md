# Add viewport meta tag and fix session page overflow on mobile

## What changed
1. Added the Next.js `viewport` export to `app/layout.tsx` with `width=device-width, initialScale=1`.
2. Fixed horizontal overflow on the session page (`EvolveSessionView.tsx`) when the preview sidebar is active: removed `minWidth` from the `<main>` inline style and added `max-w-full xl:max-w-none` so the panel is capped at 100% viewport width on mobile while still using the dynamic resizable width on xl+ screens.

## Why
Without the viewport meta tag, mobile browsers use a ~980px virtual viewport and scale the page down, making content tiny and causing overflow. The session page was also too wide on mobile because when a preview is ready (`showPreviewSidebar = true`), the `<main>` panel received an inline `width: 560px; min-width: 560px` style (for the desktop two-column resize layout) with no max-width constraint — on narrow screens this forced horizontal scrolling. The fix keeps the desktop resize handle working via `xl:max-w-none` while `max-w-full` caps the panel at 100% on smaller screens.
