# Responsive pin buttons in floating dialog

## What changed

On small screens (viewport < 452 px, where the "Propose a change" floating dialog already spans the full available width), the four corner-dock buttons in the title bar are now replaced with two simpler **Pin to top** / **Pin to bottom** buttons (using `PanelTop` / `PanelBottom` Lucide icons).

### Detail

- Added `"top"` and `"bottom"` to the `DockPosition` union type.
- Added an `isSmallScreen` state driven by a `resize` event listener (threshold: 452 px = dialog natural width 420 px + 32 px side margins).
- When `isSmallScreen` is `true`, the title bar shows the two pin buttons instead of the four corner buttons. Any free-floating position is preserved — the dialog stays where it is rather than being forced to an edge.
- Added `width: "auto"` to the inline position style for `"top"` / `"bottom"` docks so the dialog stretches edge-to-edge (overriding the Tailwind `w-[420px]` class).
- Added automatic dock conversion: switching to small screen maps corner docks → nearest top/bottom; switching back maps them to the top-right / bottom-right corner.

## Why

On a narrow phone screen the dialog is already constrained to full width by `max-w-[calc(100vw-32px)]`, so pinning to a *corner* is meaningless — all four buttons produce visually identical results. Replacing them with top/bottom pins gives the user a meaningful and immediately understandable choice.
