# Adjustable Preview Divider

## What changed

Added a draggable divider between the Session panel and the Web Preview sidebar on the `/evolve/session/[id]` page.

### `components/HorizontalResizeHandle.tsx` (new)

A reusable component for resizing a two-panel horizontal flex layout. Uses the same pattern as `FloatingEvolveDialog`'s vertical resize handle: event listeners are registered once in a `useEffect` and read from a ref, rather than being dynamically added/removed inside the `mousedown` handler. This avoids glitches caused by stale closures capturing the wrong width at the time of mousedown.

- Accepts `currentWidth`, `onWidthChange`, `containerRef`, `minLeft`, `minRight` props.
- Persistent `mousemove`/`mouseup` window listeners; active only when `dragOriginRef.current` is set.
- Sets `document.body.style.cursor = 'col-resize'` and `userSelect = 'none'` during drag; restores on mouse-up.
- Renders a pill visual (mirrors FloatingEvolveDialog's bottom handle) that turns blue on hover/active.

### `components/EvolveSessionView.tsx`

- Removed the inline drag logic (dynamic listener add/remove on mousedown).
- Replaced the raw drag `<div>` with `<HorizontalResizeHandle>`.
- Session `<main>` uses `style={{ width: mainWidthPx }}` (default 560 px) instead of the fixed Tailwind class `xl:max-w-[560px]`.
- A `containerRef` on the outer wrapper provides the total available width for clamping.

## Why

The initial implementation added/removed `mousemove`/`mouseup` listeners inside the `mousedown` handler, which caused glitchy behaviour due to stale closure capture. Extracting the pattern from `FloatingEvolveDialog` (persistent listeners + ref) fixes the jank and keeps the drag logic reusable.
