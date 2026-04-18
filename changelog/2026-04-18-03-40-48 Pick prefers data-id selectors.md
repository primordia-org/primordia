# Pick prefers data-id selectors

## What changed

The element picker's CSS selector generation now returns `[data-id="..."]` immediately when the picked element (or any ancestor during path building) has a `data-id` attribute, instead of falling through to class-based or positional selectors.

This applies to both selector generators:

- **`PageElementInspector.tsx` (`getCssSelector`)** — the TypeScript helper that wraps `css-selector-generator`. Now short-circuits before invoking the library if `el.getAttribute("data-id")` is set.
- **`WebPreviewPanel.tsx` (inline `getCssSelector` in `INSPECTOR_SCRIPT`)** — the injected iframe script that walks the DOM manually. Now checks `data-id` on the current element before checking `id` at each step of the ancestor walk, and also short-circuits at the top level for the picked element itself.

## Why

The project added `data-id` attributes to all interactive frontend elements (see changelog entry from 2026-04-18). These attributes follow a stable `scope/element-role` naming convention that maps directly to JSX source code. When an element has one, it is by far the most useful selector to give an LLM agent:

- **Stable**: unaffected by style refactors, class renames, or DOM restructuring.
- **Readable**: `[data-id="evolve/submit-request"]` immediately tells you which component and which element.
- **Unique**: the naming convention ensures no two interactive elements share the same value.

Class-based or `nth-child` selectors generated from the DOM are brittle and noisy by comparison.
