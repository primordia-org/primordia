# Remove Enter auto-submit from evolve form

## What changed

Removed the `handleKeyDown` handler from `EvolveRequestForm.tsx` that was intercepting the Enter key and auto-submitting the form. The textarea now uses its default behavior where Enter inserts newlines.

- **`components/EvolveRequestForm.tsx`** — Removed `handleKeyDown` function and its `onKeyDown` prop from the textarea. Enter now inserts newlines by default (standard textarea behavior). Only the submit button triggers the request.

## Why

Users were accidentally submitting evolve requests on mobile by pressing the Enter key. The fix ensures that only the submit button triggers a request, while Enter inserts newlines as expected in a text area.
