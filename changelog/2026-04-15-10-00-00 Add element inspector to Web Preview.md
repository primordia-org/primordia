# Add element inspector to Web Preview

## What changed

A **crosshair element inspector** tool has been added to the Web Preview panel toolbar. When activated, it lets you click any element in the live preview to capture:

- The **React component name** closest to the selected element (detected via the React fiber tree on the element's DOM node)
- A **CSS path selector** describing the element's position in the DOM (up to 5 levels deep, using IDs, class names, and `nth-of-type` disambiguators)

### How it works

1. Click the crosshair (⊕) button in the preview toolbar to enter inspect mode.  A blue hint bar appears and the cursor inside the iframe changes to a crosshair.
2. **Mouse:** hover over elements — they get a 2px blue outline highlight.  Click an element to capture it.
   **Touch (tablet/phone):** drag your finger around to highlight elements under it.  Hold still for ~600 ms to select the highlighted element.
3. The inspector deactivates and the **Follow-up** action panel opens automatically with a context chip showing:
   ```
   <ComponentName>  element.selector > path
   ```
4. Type your feedback in the Follow-up form and submit.  The element reference is automatically prepended to the request sent to Claude, giving it precise targeting information.
5. Press **Esc** or click the crosshair button again to cancel without selecting.

The context chip can be dismissed (×) before submitting if you don't want it included.

## Why

Giving precise feedback like "make this button bigger" or "fix the spacing here" was imprecise — you had to describe the element in text. The inspector lets you point at exactly what you mean, and automatically attaches the React component name and CSS selector so Claude knows exactly which component and element to target.

## Files changed

- `components/WebPreviewPanel.tsx` — inspector mode toggle, iframe script injection, postMessage listener, Escape-to-cancel, `onElementSelected` prop
- `components/EvolveSessionView.tsx` — `elementContext` state, `handleElementSelected` callback, context chip UI in the follow-up panel, element context prepended to follow-up request on submit
