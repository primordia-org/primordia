# Fix restart dev server button shown during starting state

## What changed

In `components/EvolveSessionView.tsx`, the "Restart dev server" button inside the
`status === "ready"` panel was shown unconditionally — including when
`devServerStatus === "starting"`. Offering a restart while the server is already
spinning up is confusing and redundant.

### Changes

- The restart button is now hidden when `devServerStatus === "starting"`.
- The current `devServerStatus` value is always displayed as a label in the panel
  (e.g. `none`, `starting`, `running`, `disconnected`) so the user can see exactly
  what state Primordia thinks the dev server is in.

## Why

The user observed the button appearing at the wrong time and suspected the app was
falsely reporting a non-`starting` state. The label makes the true state visible,
and hiding the button during `starting` prevents a misleading action from being
offered before the server has had a chance to come up.
