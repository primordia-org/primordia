# Add Claude run time and cost metrics

## What changed

Four metrics are captured for every agent run and displayed inline:

- **Time** — wall-clock duration of the run
- **Cost** — total API cost in USD
- **Tokens in / out** — input and output token counts

Each section (initial run, follow-up requests, type-error fixing, etc.) shows its own separate metrics row, so you can see the cost and speed of each individual phase.

### Metrics on failure

Metrics are now always reported, even when the agent errors or is aborted:

- **`scripts/claude-worker.ts`** — tracks a wall-clock `startTime` at the beginning of each run. On error/abort/timeout, `startTime` is used as a fallback when the SDK's `duration_ms` is unavailable (the SDK only returns `duration_ms` on clean success).
- **`scripts/pi-worker.ts`** — a shared `baselineStatsRef` is now stored in the outer scope so that abort, timeout, and outer-catch error paths can all read `activeSession.getSessionStats()` and compute incremental token / cost deltas. Previously those paths emitted `null` for all three values.

### Live metrics while running

Running agent sections now show metrics in real time — users can see elapsed time and token/cost data while deciding whether to abort:

- **`scripts/pi-worker.ts`** — emits a `metrics` event after every assistant turn (`message_end`) so the UI always has the latest token and cost snapshot.
- **`app/evolve/session/[id]/EvolveSessionView.tsx`** — `RunningClaudeSection` now:
  - Shows a live elapsed-time counter (updated every second via `setInterval`) in the section header, next to the pulsing indicator.
  - Reads the latest `metrics` event from the section's event stream and renders it as a `MetricsRow` at the section footer. The elapsed time shown there overrides the `durationMs` from the event so it stays live.

### SectionGroup carries its start timestamp

`groupEventsIntoSections` now stores `startTs` (the `ts` field from the `section_start` event) on each `SectionGroup`. This is passed down to `RunningClaudeSection` so the timer can calculate elapsed time even if no partial metrics event has arrived yet.

### Data collection (original implementation)

The worker captures the SDK `result` message's `duration_ms`, `total_cost_usd`, and `usage.{input,output}_tokens` fields and writes them as a structured `metrics` NDJSON event at the end of each run. The UI reads this event per section from `groupEventsIntoSections`.

### UI rendering

Metrics display:
- Time as `Xs` (< 1 min) or `Xm Ys` (≥ 1 min)
- Cost as `$0.0000` (four decimal places)
- Token counts as `X,XXX in / Y,YYY out`
- Any field that is unavailable (null) is simply omitted from the row

## Why

- Users should always be able to see how much a run cost, even when it fails — "77 tool calls made" with no metrics is not enough information.
- Showing live elapsed time and partial token/cost data while an agent is running lets users make an informed decision about whether to abort (e.g. "it's already spent $0.50 and hasn't finished yet").
