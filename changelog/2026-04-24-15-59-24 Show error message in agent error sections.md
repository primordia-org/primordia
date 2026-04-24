# Show error message in agent error sections

## What changed

When a Claude Code agent session fails with `subtype: 'error'`, the `result` event stored in the NDJSON log already carries a `message` field containing the actual error text. However, `DoneClaudeSection` in `EvolveSessionView.tsx` was not rendering this message — the UI only showed the heading "❌ Claude Code (Claude Sonnet 4) errored" and the timing row, with no details about *why* it failed.

Added an "Error details" block inside `DoneClaudeSection` that renders `resultEvent.message` in a monospace preformatted block (red-tinted background) whenever `hasError` is true and a message is present.

## Why

Users were seeing an unhelpful error state: just the word "errored" and `Time 0.0s` with no actionable information. The error details were already being persisted to disk — they just weren't surfaced in the UI. This change makes the root-cause visible without changing any backend behaviour.
