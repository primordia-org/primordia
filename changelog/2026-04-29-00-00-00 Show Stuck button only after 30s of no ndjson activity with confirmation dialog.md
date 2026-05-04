# Show "Stuck?" button only after 30 s of NDJSON inactivity, with confirmation dialog

## What changed

The "Force Reset" button on evolve session pages (shown during `accepting` and `fixing-types`
states) has been replaced with a smarter **"Stuck?"** button that only appears when the session
has genuinely stalled:

- **30-second inactivity threshold**: The button is hidden by default. A 2-second polling
  interval checks whether the last NDJSON event from the SSE stream was more than 30 seconds
  ago. If so, the "Stuck?" button fades in.
- **Auto-hide on activity**: Whenever new events arrive from the SSE stream the timer resets and
  the button is hidden again, so it only shows when things are truly stuck.
- **Confirmation dialog**: Clicking "Stuck?" opens a modal dialog that explains what the reset
  does (returns the session to `ready` so the user can retry or submit a follow-up), and
  requires explicit confirmation before proceeding. Clicking outside the dialog or "Cancel"
  dismisses it safely.

## Why

The old "Force Reset" button was always visible during `accepting` / `fixing-types`, which made
it easy to accidentally click during a normal (healthy) deploy and interrupt it mid-flight.
By gating it behind a 30-second inactivity window and a confirmation step, the button is now
only surfaced when it's genuinely needed, and users are protected from accidental resets.
