# Include initial user request in NDJSON session log

## What changed

Added a new `initial_request` event type to the `SessionEvent` union in `lib/session-events.ts`. When a new session starts, the initial user request text is now written as the very first event in the `.primordia-session.ndjson` file (before the `section_start` setup event).

## Why

Follow-up requests were already captured in the log as `followup_request` events, but the original request that kicked off the session was never recorded. This made the NDJSON log incomplete — you couldn't reconstruct what the user originally asked for without consulting the SQLite database. Including the initial request makes the NDJSON file a self-contained record of the full session.
