# Fix CLI API logs and attachments

Updated Primordia Core CLI/API behavior for log and thread request commands.

- Added `primordia thread logs` and `/api/core/thread/{threadId}/logs` to read a thread's `.primordia-session.ndjson` file.
- Added `--lines/-n` support to thread server logs and kept `--follow/-f` opt-in rather than default.
- Clarified that CLI `--json` means machine-formatted output rather than a guarantee that every command prints one JSON document.
- Made all log commands print newline-delimited JSON when `--json` is enabled. Thread session logs emit their raw NDJSON events; text server/service logs wrap each line in a JSON object.
- Made `primordia thread logs` render the session event stream as concise, human-readable console text when `--json` is not provided, coalescing adjacent text events inline instead of printing each chunk on its own line.
- Core API log calls with `json=true` now return `application/x-ndjson`, with or without `follow=true`.
- Restored repeatable `--attach/-a <file>` on `thread create` and `thread followup`.
- Extended Core API multipart parsing so create/follow-up endpoints can accept attached files from a simple HTML form using `multipart/form-data`.
