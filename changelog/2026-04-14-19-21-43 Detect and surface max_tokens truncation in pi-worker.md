# Detect and surface max_tokens truncation in pi-worker

## What happened in the `llm-gateway-integration` session

Pi stopped after writing "Now fix the sample markdown table in
`markdown-stream/route.ts`:" without executing the final edit. The
session logged `result: success` and appeared complete, but the file
was never changed. The user had to submit a follow-up ("continue") to
finish the work.

## Root cause

When Claude hits the `max_tokens` output limit it returns with
`stop_reason: "max_tokens"`. The Pi SDK maps that to
`stopReason: "length"` on the `AssistantMessage`. The agent loop in
`agent-loop.js` only exits early for `stopReason === "error"` or
`"aborted"`; `"length"` falls through as if the model had finished
normally. Because no tool calls appear in a truncated response, the
inner loop terminates, `agent_end` is emitted, and
`session.prompt()` resolves without throwing. `pi-worker.ts` had no
awareness of this condition and always wrote `result: success`.

## Fix (`scripts/pi-worker.ts`)

1. **Track stop reason** — added a `lastAssistantStopReason` variable.
   The existing `session.subscribe()` callback now also handles
   `message_end` events: when the message role is `"assistant"` its
   `stopReason` string is captured.

2. **Check after `session.prompt()` resolves** — before writing the
   final `result` and `metrics` events, inspect
   `lastAssistantStopReason`. If it is `"length"`:
   - Append a `text` event with a visible ❌ message telling the user
     Pi was cut off and they should submit a follow-up.
   - Write `result: error` (instead of `result: success`) so the
     session UI shows an error indicator and the progress log is not
     misleadingly green.

3. **Normal path unchanged** — if the last stop reason is anything
   other than `"length"`, `result: success` is written as before.
