# Fix cumulative cost reporting in pi-worker follow-up runs

## What changed

- **`scripts/pi-worker.ts`**: Snapshot `session.getSessionStats()` *before* calling `session.prompt()` (baseline). After the prompt completes, compute incremental token/cost deltas (`finalStats - baseline`) and write only those to the `metrics` NDJSON event. Previously the full cumulative session totals were written, causing follow-up sections to display inflated (cumulative) figures.
- **`lib/session-events.ts`** (`buildSessionFromWorktreePath`): Changed metrics aggregation from "last event wins" to summing all `metrics` events. Each event now carries incremental values, so summing gives the correct session-wide totals used on the session list/detail views.

## Why

When a follow-up request is processed with `useContinue: true`, the Pi SDK resumes the existing session file and accumulates token counts across all turns. Calling `session.getSessionStats()` at the end of a follow-up returned the total for *all* turns (initial + follow-ups), not just the current run.

This meant:
- The `metrics` NDJSON event for a follow-up section stored the full session cost, not the incremental cost of that follow-up.
- The per-section `MetricsRow` in the UI showed misleadingly large numbers (appeared to triple-count tokens across three runs, for example).
- `buildSessionFromWorktreePath` used only the last metrics event, so the `costUsd` / `inputTokens` / `outputTokens` fields on `EvolveSession` also held cumulative totals that grew with every follow-up, misrepresenting total session cost.

The fix records only the delta per run and sums across all events when building the session record, giving accurate per-section and per-session cost/token figures.
