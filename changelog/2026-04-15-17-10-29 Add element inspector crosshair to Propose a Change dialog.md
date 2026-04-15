# Add element inspector crosshair to "Propose a Change" dialog and session follow-up form

## What changed

Added a **Pick element** (crosshair) tool to every evolve request form — the floating "Propose a change" dialog, the `/evolve` standalone page, and the session follow-up form — so users can click any visible element on the current page and automatically attach its details to their request.

### New file: `components/PageElementInspector.tsx`

A full-screen transparent portal overlay that activates on top of the page.

- **Mouse:** move cursor to highlight elements; click to select.
- **Touch:** drag to highlight; hold 600 ms to select.
- **Keyboard:** `Esc` to cancel.

Uses `document.elementsFromPoint()` to resolve the element under the pointer, filtering out the inspector overlay itself and an optional `skipElement` (the calling form panel) so dialog chrome is never returned as a selection. Walks the React fibre tree to detect the nearest named React component.

Also exports the following utilities used at capture time:

| Export | Purpose |
|---|---|
| `getReactComponentChain(el)` | Array of all named React component ancestors, root → leaf |
| `generateFiberTreeText(el)` | JSX-like tree rendered from the nearest React component boundary down, with the selected element marked `← SELECTED` |
| `captureElementFiles(el, info)` | Async; returns `File[]`: a PNG screenshot + a Markdown details file |
| `getCssSelector(el)` | Compact CSS path (up to 5 ancestors, skipping Tailwind utility classes) |
| `getReactComponentName(el)` | Nearest named React component from fibre tree |

#### Screenshot approach (`element-{name}-screenshot.png`)
Uses SVG `<foreignObject>` + Canvas: embeds the element's `outerHTML` along with all same-origin CSS rules (capped at 300 KB) into an SVG, renders it to an `<img>`, then draws it to a Canvas and exports as PNG. Works best for elements with inline structure; Tailwind classes are preserved when the stylesheet is accessible (dev mode). Falls back silently on failure.

#### Details Markdown (`element-{name}-details.md`)
Contains:
- React component chain (e.g. `App > Layout > NavHeader > [span]`)
- CSS selector
- `outerHTML` (up to 600 chars)
- React fibre tree (JSX-like, up to 12 levels deep, 400 nodes) with the selected element marked

### Modified: `components/EvolveRequestForm.tsx`

- Reverted from `forwardRef` back to a plain function export (no longer needed — inspector is now internal).
- Added `inspectorSkipElement?: HTMLElement | null` prop — passed in from `FloatingEvolveDialog` so the dialog itself is excluded from element picking.
- New internal state: `inspectorActive` (boolean) + `elementAttachments: ElementAttachmentDraft[]`.
- **Pick element** button added to the action row (between "Attach files" and the submit button). Compact label: "Pick". Full label: "Pick element".
- When an element is selected, an `ElementAttachmentDraft` is created immediately with `status: "generating"`, then `captureElementFiles()` runs asynchronously to produce the PNG + Markdown files.
- **Element attachment chips** (blue, with Crosshair icon and spinner during generation) appear in the chip row alongside regular file chips. Tooltip shows the CSS selector and file names.
- On submit, `elementAttachments` files (status `"ready"`) are merged with regular `attachedFiles` and sent through the existing attachment mechanism (FormData `attachments[]` for new sessions; `files` array for follow-up `onSubmit` callbacks).
- Form reset clears `elementAttachments` alongside the other fields.

### Modified: `components/FloatingEvolveDialog.tsx`

- Removed all previous inspector state (`crosshairActive`, `formRef`) and the title-bar Crosshair button (inspector is now inside the form).
- Passes `inspectorSkipElement={dialogRef.current}` to `EvolveRequestForm` so the dialog container is excluded from element picking.
- Form body is no longer conditionally hidden; the dialog renders the full form at all times.

## Why

Previously, element selection only inserted a short text snippet into the textarea. This follow-up redesigns the feature so:

1. **No clutter in the request text** — the element details are stored as file attachments (screenshot + Markdown) that Claude Code can open if it needs them, rather than inline prose that pads the user's message.
2. **Richer context** — the Markdown file includes the full React component chain, the CSS selector, truncated `outerHTML`, and a fibre-tree JSX snapshot, giving Claude Code precise multi-dimensional context to locate and edit the right element.
3. **Visual attachment chip** — a single blue `<ComponentName>` chip in the form's attachment row shows exactly what was captured, with a spinner during async file generation and a tooltip listing the generated file names.
4. **Works everywhere** — the inspector is embedded in `EvolveRequestForm` itself, so it works in the floating dialog, the `/evolve` page, and the session follow-up form without any duplication.
