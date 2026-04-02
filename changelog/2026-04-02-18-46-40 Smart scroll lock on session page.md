# Smart scroll lock on session page

## What changed

The session page (`/evolve/session/[id]`) previously scrolled to the bottom every time a new log entry was received, using smooth scrolling. This was disruptive when a user had scrolled up to read earlier output — the page would yank them back down.

The auto-scroll behavior in `EvolveSessionView.tsx` now:

- Tracks scroll position via a persistent `scroll`/`resize` event listener into a `wasAtBottomRef` ref — this captures the user's position *before* new content is rendered.
- When new progress arrives, checks `wasAtBottomRef` to decide whether to scroll.
- If the user was at the bottom, scrolls instantly (`behavior: "instant"`) to keep up with new content without lag.
- If the user has scrolled up, does nothing — the reading position is preserved.
- Uses `document.documentElement.clientHeight` (layout viewport) instead of `window.innerHeight` (visual viewport) so mobile address-bar hide/show does not produce false "not at bottom" readings.

The threshold is 40px to absorb minor pixel-rounding differences.

**Key fix from first attempt:** the original implementation checked scroll position inside the `progressText` effect — i.e., *after* the new content was already in the DOM. At that point `scrollHeight` had grown but `scrollY` hadn't moved, so the "am I at the bottom?" check always failed even when the user was sitting at the bottom. Switching to a scroll-event-maintained ref solves this timing issue.

## Why

Smooth-scrolling on every update was jarring when intentionally scrolling up, and there was no way to stay scrolled up to read earlier log entries while new ones arrived. The first attempt to fix it didn't work because of a scroll-position timing bug and a mobile viewport height issue.
