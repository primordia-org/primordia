# Make "Propose a change" dialog resizable and anchor under hamburger

## What changed

- **`FloatingEvolveDialog`**: The dialog is now resizable via a native browser resize handle (CSS `resize: both`). Width is set to 420 px by default with a 280 px minimum; the user can drag the bottom-right corner to make it wider or taller. The textarea uses `flex-1` to fill all available vertical space as the dialog grows, rather than being capped at a fixed height. The form body gains `overflow-y: auto` so content scrolls rather than clips if the dialog is made very small.

- **Anchor positioning**: `FloatingEvolveDialog` now accepts an optional `anchorRect` prop (`DOMRect | null`). When provided, a `useLayoutEffect` on mount positions the dialog so its top-right corner sits 8 px below the bottom-right of the anchor rect — i.e. directly under the hamburger button that opened it. Dragging or docking still works normally after the initial placement.

- **`HamburgerMenu`**: Added an optional `containerRef` prop (`React.RefObject<HTMLDivElement | null>`). When passed, it is used as the container div ref instead of the internal one, giving callers access to the hamburger's bounding rect without any extra DOM wrapper.

- **Callers** (`ChatInterface`, `PageNavBar`, `EvolveSessionView`): Each now holds a `hamburgerRef` and a `evolveAnchorRect` state. When "Propose a change" is clicked, the current `getBoundingClientRect()` of the hamburger container is captured and forwarded to `FloatingEvolveDialog` as `anchorRect`.

## Why

The dialog used to open at a fixed corner (bottom-right by default), forcing users to hunt for it. Opening it right under the menu button that triggered it makes the transition feel immediate and predictable. Resizability lets users expand the text area for longer change descriptions without having to navigate away to the full `/evolve` page.
