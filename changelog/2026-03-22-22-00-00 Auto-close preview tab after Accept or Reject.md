# Auto-close preview tab after Accept or Reject

## What changed

In `components/AcceptRejectBar.tsx`, both `handlePreviewAccept` and `handlePreviewReject` now automatically close the preview browser tab (and focus the parent tab) after the action completes successfully.

Specifically, after a successful accept or reject response from the server:

1. `window.opener?.focus()` is called to bring the parent tab (the evolve form that originally opened the preview via `target="_blank"`) back into view.
2. `window.close()` is called after a 1500 ms delay so the user briefly sees the success confirmation message before the tab disappears.

Both calls are wrapped in `try/catch` to safely handle cases where the window was not opened via `window.open()` (i.e., `window.opener` is null) or where browser security policy prevents the operation.

## Why

Previously, after clicking **Accept Changes** or **Reject**, the merge/cleanup succeeded but the preview dev server was then killed by `process.exit(0)`. This left the browser tab pointing at a dead port, showing the exe.dev "port unbound" error page. The user had to manually close the tab, which was jarring.

By closing the window from the client side — before the server exits — the tab disappears cleanly and the user is immediately returned to the parent context where they can see the live (now-updated) app.
