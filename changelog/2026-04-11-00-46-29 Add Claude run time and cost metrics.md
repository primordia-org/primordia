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
- **`scripts/claude-worker.ts`** — same treatment: each `SDKAssistantMessage` carries a `BetaMessage` with per-turn `usage.{input_tokens,output_tokens}`. The worker now accumulates those token counts and emits a partial `metrics` event after every assistant turn. Cost stays `null` until the final `result` message (where `total_cost_usd` is available), but elapsed time and token counts update live. Error result messages (`SDKResultError`) also carry `total_cost_usd` and `usage`, so those are captured before throwing — meaning failure metrics are now complete, not just the time fallback.
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

---

## Fix: follow-up model/harness selection now always respected

### What changed

Two bugs in `lib/evolve-sessions.ts` → `runFollowupInWorktree` (and `startLocalEvolve`) are fixed:

**Bug 1 — model mismatch between UI label and worker**

The `section_start` event was logged using `session.model ?? DEFAULT_MODEL` (so the UI always showed a concrete model name), but the worker was spawned with `model: session.model` (which could be `undefined` when the form submitted the default). This caused the header in the session view to display one model while the worker silently ran a different one.

Fix: resolve the model ID once (`const fuModelId = session.model ?? DEFAULT_MODEL`) before logging the `section_start` event, then pass `fuModelId` to both the event and the worker config. The same fix was applied to `startLocalEvolve`.

**Bug 2 — cross-harness follow-up incorrectly used `useContinue: true`**

If the user switched harness (e.g. `claude-code` → `pi`) for a follow-up request, the old code still passed `useContinue: true` to the new harness worker. Each harness stores its session state in a different format, so the new worker cannot resume the old session — it either crashes or starts fresh with no context at all.

Fix: detect the previous harness by reading the most recent `section_start` `sectionType: 'agent'` event from the NDJSON log. If the harness changed, `useContinue` is set to `false` and a context block is injected into the prompt:

- The relative path to `.primordia-session.ndjson` (so the new agent can read the full structured history)
- The text of the initial request and every previous follow-up request
- A note that the work was done by a different agent in the same worktree and that committed changes already exist

If the harness is the same (even with a different model), `useContinue: true` continues to be passed so the agent resumes its own conversation history as before.

### Why

User model/harness selection must be respected exactly — running the wrong model silently wastes budget and gives unexpected results. Switching harnesses is a supported workflow (e.g. starting with `claude-code` then refining with `pi`) but requires the new agent to understand what has already been done.
