# Include initial user request in NDJSON session log

## What changed

- Added a new `initial_request` event type to the `SessionEvent` union in `lib/session-events.ts`. When a new session starts, the initial user request text is now written as the very first event in the `.primordia-session.ndjson` file (before the `section_start` setup event).
- Both `initial_request` and `followup_request` events now include an `attachments` field listing the filenames of any files the user uploaded with their request.
- The "Your Request" and "Follow-up Request" sections on the session page now display file attachment chips when attachments were included with the request. Chips are clickable links that open the file; image attachments also show a small inline thumbnail preview. The attachment link URL uses the configured base path so it works correctly on preview servers.

## Why

Follow-up requests were already captured in the log as `followup_request` events, but the original request that kicked off the session was never recorded. This made the NDJSON log incomplete — you couldn't reconstruct what the user originally asked for without consulting the SQLite database. Including the initial request makes the NDJSON file a self-contained record of the full session.

File attachments are now surfaced in the session view so it's clear what files were part of a request, not just the text.
