# Detect silent stop in pi-worker when model finishes with no visible output

## What changed

`scripts/pi-worker.ts` gained three new detection / visibility improvements:

### 1. Silent-stop detection (the core fix)

Pi can stop "successfully" (result `subtype: success`, UI shows "🤖 Pi finished") without
having done any visible work. This happens when the model's final turn produces **only
reasoning/thinking tokens** — no `text_delta` events fire, no tool calls are made, and the
agent loop exits cleanly because `stopReason === 'stop'` and `toolCalls.length === 0`.

This is distinct from the already-handled `stopReason === 'length'` (max-output-tokens
truncation) case. The model _chose_ to stop, it just spent all its output budget on internal
reasoning rather than on a visible conclusion.

Root-cause confirmed by examining the session log for this very investigation: the worker
made 46 tool calls reading SDK source files over ~5.7 minutes, generated 19 689 output
tokens (many of them reasoning), and then stopped with a 79-token silent final turn — no
`text` event, no new tool calls, `subtype: success`.

**Fix:** after `session.prompt()` resolves, inspect the last assistant message's content
array. If it has no text blocks with non-empty content _and_ no tool-call blocks, the turn
is classified as a **silent stop** and reported as `subtype: error` with a follow-up hint.
Two new flags (`lastAssistantHadVisibleOutput`, `lastAssistantHadToolCalls`) are tracked in
the `session.subscribe` callback that already watches `message_end` events.

### 2. Context window usage reporting

After the session completes, `session.getContextUsage()` is called. If the context window
is ≥ 75 % full, a warning `text` event is written before the `result` event so users can
see exactly how full the context was and understand why Pi may have stopped short.

### 3. Compaction and auto-retry event logging

The `session.subscribe` callback now also handles:

- **`compaction_start` / `compaction_end`** — logs a ⚙️ note when the SDK automatically
  summarises the conversation history to free context space (and a ⚠️ if it fails).
- **`auto_retry_start` / `auto_retry_end`** — logs 🔄 / ❌ notes when the SDK retries a
  failed LLM request, and warns when retries are exhausted.

These events were previously invisible, making it hard to understand why Pi paused or
behaved unexpectedly mid-session.

## Why

The user repeatedly encountered sessions where Pi reported success but hadn't implemented
anything. The existing `stopReason === 'length'` check (added earlier) only catches
output-truncation; it doesn't cover the "silent stop via reasoning tokens" case.
Examining the actual NDJSON session log produced by the misbehaving session confirmed the
diagnosis and informed the specific fix.
