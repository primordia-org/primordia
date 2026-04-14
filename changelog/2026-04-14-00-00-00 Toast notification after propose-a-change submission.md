# Toast notification after propose-a-change submission

## What changed

When a user submits a request via the floating "Propose a change" dialog, the
app no longer navigates to the new session page. Instead:

1. The dialog closes immediately.
2. A fixed toast notification appears at the bottom-centre of the screen with
   the message **"Request submitted!"** and a **"View session →"** link.
3. The toast fades out and disappears automatically after **5 seconds**.

## Why

The floating dialog is designed to let users keep the current page visible
while describing a change. Immediately redirecting away defeats that purpose —
the user loses their place. A transient toast is less disruptive: it confirms
the submission and provides a link without forcing navigation.

## Implementation details

- `EvolveRequestForm` gained an `onSessionCreated?: (sessionId: string) => void`
  prop. When provided, it is called with the new session ID instead of calling
  `router.push()`, and the form resets automatically.
- `FloatingEvolveDialog` gained an `onSessionCreated?: (sessionId: string) => void`
  prop. On form success it calls `onClose()` then forwards the ID to the
  parent via this prop.
- A new `EvolveSubmitToast` component was added (exported from
  `FloatingEvolveDialog.tsx`). It renders via a React portal onto
  `document.body` so it outlives the dialog's unmount. It manages its own
  5-second fade-out lifecycle internally.
- `ChatInterface`, `EvolveSessionView`, and `PageNavBar` — the three parent
  components that render the floating dialog — each gained a `toastSessionId`
  state and render `<EvolveSubmitToast>` when a session is created.
- The standalone `/evolve` page form is unaffected and continues to navigate
  to the session page on submit.
