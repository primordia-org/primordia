# Make "Propose a change" dialog resizable on mobile

## What changed

Added a custom touch-and-mouse drag handle at the bottom of the `FloatingEvolveDialog` component, enabling vertical resizing on mobile devices.

Previously, the dialog used only the CSS `resize: both` property, which relies on a browser-native corner grab handle that is not accessible on touch screens. This meant mobile users were stuck with the default auto-height dialog and could not resize it.

### Changes to `components/FloatingEvolveDialog.tsx`

- **Removed** the `resize` Tailwind class (CSS `resize: both`) from the outer dialog div.
- **Added** `dialogHeight` state (`number | null`) to track an explicit pixel height set by dragging.
- **Added** `resizeOriginRef` to store the drag start position and initial height.
- **Added** `startResize(clientY)` function that captures the starting position/height.
- **Added** a new `useEffect` that listens for `mousemove`/`mouseup` and `touchmove`/`touchend` globally to update `dialogHeight` during a resize drag (mirrors the existing drag-to-move effect).
- **Added** a visible bottom bar (pill indicator + `cursor-ns-resize`) as the resize handle UI, with `onMouseDown` and `onTouchStart` handlers.
- **Applied** `dialogHeight` as an inline `height` style on the outer div when set; falls back to auto-height otherwise.
- **Added** `min-h-[200px]` to prevent the dialog from collapsing too small.
- **Added** `min-h-0` to the form body div so it correctly shrinks inside a flex container when the dialog is resized smaller.

## Why

Users on mobile phones need to be able to resize the floating dialog to see more of the underlying page or to give themselves more text entry space. The standard CSS resize mechanism is desktop-only; a custom touch event handler is required for mobile.
