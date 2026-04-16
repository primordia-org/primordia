# Enhanced preview element inspector with dual-color highlights and source file

## What changed

### Dual-color highlight system

Both the iframe inspector (`WebPreviewPanel`) and the page overlay inspector (`PageElementInspector`) now show two distinct outlines and two labels simultaneously when hovering over an element:

- **Green outline + green label** — the specific DOM element under the cursor, with its CSS element path shown in the green label.
- **Blue outline + blue label** — the nearest enclosing React component's root DOM element, with the component name shown in the blue label (e.g. `<ChatInterface>`).

Previously both inspectors showed a single blue outline/label combining the component name and selector in one string.

### Source filename in picker Markdown

When an element is captured via the picker (crosshair tool), the generated `element-*-details.md` attachment now includes a **Source File** section when a `data-source-file` attribute is present in the DOM ancestry. This attribute is injected at build time by the `swc-plugin-component-annotate` plugin already configured in `next.config.ts`.

This gives Claude Code precise file-level context alongside the component name and JSX tree, making follow-up requests more accurate.

### EvolveSessionView follow-up prefix

When a user sends a follow-up request with an element selected in the iframe inspector, the request prefix now also includes the source file when available:

- Before: `Re: <MyComponent> div.some-class`
- After: `Re: <MyComponent> (components/MyComponent.tsx) div.some-class`

## Files changed

- `components/PageElementInspector.tsx` — added `getDataSourceFile()`, `getComponentRootElement()`, updated `HoverLabel` to render two stacked labels (blue + green), updated highlight boxes to show green (element) + blue (component), updated `captureElementFiles()` to include Source File section.
- `components/WebPreviewPanel.tsx` — added `getComponentRootDomEl()`, `getDataSourceFile()`, `makeLabel()`, `positionLabels()`, `removeLabels()`, `updateComponentHighlight()`, `removeComponentHighlight()` inside `INSPECTOR_SCRIPT`; updated `setHighlight` to use green for element outline + blue component overlay; updated `clearHighlight` to clean up all three elements (green outline, blue overlay, labels); updated `selectElement` to pass `sourceFile` in postMessage; updated `ElementSelection` interface to include optional `sourceFile`; updated `handleMessage` to forward `sourceFile`.
- `components/EvolveSessionView.tsx` — updated follow-up request prefix to include source file when available.
