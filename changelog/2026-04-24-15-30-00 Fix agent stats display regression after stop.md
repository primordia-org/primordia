# Fix agent stats display regression after stop

## What changed

- `DoneClaudeSection` in `EvolveSessionView.tsx` now uses the **last** `metrics` event instead of the first one when rendering time, tokens, and cost for a completed agent section.
- Added `startTs` prop to `DoneClaudeSection` (forwarded from the `SectionGroup`), and use it as a fallback to compute `durationMs` from `section_start.ts → result.ts` when the final metrics event has a null or zero `durationMs`.
- Both `StructuredSection` call-sites that render `DoneClaudeSection` now pass `startTs`.

## Why

The previous commit (`cd395a7`) introduced live partial `metrics` events — one written after each assistant turn so the running section could show live token/cost data. However, `DoneClaudeSection` still used `events.find()`, which returns the **first** metrics event (an early partial snapshot), not the final comprehensive one that is written after the `result` event.

This caused three regressions when viewing a completed agent section:

1. **Time elapsed showed 0** — the first partial metrics event can have a very small or zero `durationMs` if the agent responded quickly, while the final event has the true wall-clock duration.
2. **Tokens not displayed** — intermediate metrics from `claude-worker` accumulate input/output tokens incrementally; the first snapshot may have zero counts if emitted before the first token usage was recorded.
3. **Cost not displayed** — `claude-worker` emits `costUsd: null` on all intermediate events (cost is only available in the final result message from the SDK), so any session that used the claude-worker harness showed no cost in the done state.

Switching to `[...events].reverse().find(...)` picks the last metrics event (the final one), which always has accurate totals. The `startTs`-based fallback for `durationMs` covers edge cases where the SDK doesn't report `duration_ms`.
