# Fix Pi not reporting 402 credits-exhausted errors as session errors

## What changed

Updated `scripts/pi-worker.ts` to correctly detect and surface API errors that
the Pi SDK delivers via `message_end` (rather than `message_update`) events.

Two fixes:

1. **`message_end` handler — capture HTTP errors (e.g. 402)**  
   When the Anthropic API returns an HTTP error (such as "402 LLM credits
   exhausted"), the `pi-ai` Anthropic provider emits `{ type: 'error' }` on the
   stream.  The `pi-agent-core` agent-loop converts this directly into a
   `message_start` + `message_end` pair — it does *not* emit a `message_update`
   event.  The existing code only checked `message_update` for `ae.type ===
   'error'`, so the error was invisible to the worker and the session was
   falsely reported as "finished" (success) with 0 tokens.  
   The fix: inspect `message.stopReason` in the `message_end` handler and, when
   it equals `'error'`, capture `message.errorMessage` into `lastApiErrorMessage`
   so it is re-thrown after `session.prompt()` resolves and the session is
   correctly marked as errored.

2. **`auto_retry_end` handler — propagate exhausted-retry errors**  
   When the Pi SDK exhausts all auto-retries (e.g. for transient 5xx errors),
   it emits `auto_retry_end` with `success: false` and a `finalError` string.
   The existing code logged this as text in the session but did not set
   `lastApiErrorMessage`, so those sessions also silently resolved as success.
   The fix: set `lastApiErrorMessage` from `finalError` when `success` is false.

## Why

The screenshot showed "Pi (Claude Sonnet 4.6) finished" in green after a 402
credits-exhausted API error.  Claude Code, which uses a different code path,
correctly reported the same error as "Claude Code errored".  Both harnesses
should surface API errors consistently so users know something went wrong and
don't mistake a failed run for a successful one.
