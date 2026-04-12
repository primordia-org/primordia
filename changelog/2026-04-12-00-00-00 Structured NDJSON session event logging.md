# Structured NDJSON session event logging

Session progress is now stored as structured NDJSON events in
`.primordia-session.ndjson` inside each worktree, replacing the previous
approach of accumulating a giant Markdown string in SQLite.

## What changed

**Storage format**

Each event (tool call, Claude text output, setup step, metrics, etc.) is
appended as a single JSON object on its own line. Events are typed:
`section_start`, `setup_step`, `text`, `tool_use`, `result`, `metrics`,
`log_line`, `followup_request`, `decision`, `legacy_text`.

**Streaming**

The `/api/evolve/stream` endpoint now reads NDJSON lines and sends them as
structured `SessionEvent[]` arrays via SSE, with a `lineCount` offset so
reconnecting clients only fetch new events. The old character-offset approach
is gone.

**Rendering**

`EvolveSessionView` now accumulates `SessionEvent[]` and groups them into
display sections instead of parsing Markdown. Tool calls are rendered from
their structured `name` + `input` fields; metrics come from dedicated
`metrics` events. Legacy sessions (no NDJSON file) fall back to the old
Markdown renderer via a `legacy_text` event.

File paths in tool call summaries are shortened so that the worktree
directory is displayed as `.` (e.g. `./components/Foo.tsx` instead of the
full absolute path). The extraneous "Preview ready" block that was embedded
in the structured section renderer has been removed — the preview server
status is shown independently via the proxy panel.

**Worker**

`scripts/claude-worker.ts` writes every tool call, text chunk, result, and
metrics event directly to the NDJSON file as they arrive, making the event
log the single source of truth.

**Abort recovery**

The server-restart recovery path in `/api/evolve/abort` now appends a
`log_line` event to NDJSON instead of appending text to `progressText`.
