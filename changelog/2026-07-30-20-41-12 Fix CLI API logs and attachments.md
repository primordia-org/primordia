# Fix CLI API logs and attachments

Updated Primordia Core CLI/API behavior for log and thread request commands.

- Added `primordia thread logs` and `/api/core/thread/{threadId}/logs` to read a thread's `.primordia-session.ndjson` file.
- Added `--lines/-n` support to thread server logs and kept `--follow/-f` opt-in rather than default.
- Allowed `--json --follow` on log commands; streaming Core API calls with `follow=true&json=true` now return `application/x-ndjson`.
- Restored repeatable `--attach/-a <file>` on `thread create` and `thread followup`.
- Extended Core API multipart parsing so create/follow-up endpoints can accept attached files from a simple HTML form using `multipart/form-data`.
