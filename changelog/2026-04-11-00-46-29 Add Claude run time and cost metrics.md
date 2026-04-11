# Add Claude run time and cost metrics

## What changed

Four metrics are captured for every Claude Code run and displayed inline at the bottom of each Claude Code section:

- **Time** — wall-clock duration of the run
- **Cost** — total API cost in USD
- **Tokens in / out** — input and output token counts

Each section (initial Claude Code run, follow-up requests, type-error fixing, etc.) shows its own separate metrics row, so you can see the cost and speed of each individual phase.

### Storage

Four nullable columns were added to the `evolve_sessions` SQLite table via additive migrations:

- `duration_ms INTEGER`
- `input_tokens INTEGER`
- `output_tokens INTEGER`
- `cost_usd REAL`

These hold the most-recent run's metrics (used as a fallback for sessions recorded before per-section embedding was available).

### Data collection (`scripts/claude-worker.ts`)

The worker captures the SDK `result` message's `duration_ms`, `total_cost_usd`, and `usage.{input,output}_tokens` fields on every exit path (success, timeout, user abort, error). After capturing them, it appends a compact HTML comment to the progress text — e.g. `<!-- metrics: {"durationMs":12500,"costUsd":0.0042,"inputTokens":2345,"outputTokens":1234} -->` — so that each section permanently carries its own metrics inside the progress text itself.

### UI (`components/EvolveSessionView.tsx`)

Each finished Claude Code or type-fix section now parses the embedded metrics comment from its content and renders a compact **metrics row** at the section footer showing Time, Cost, and Tokens. The metrics comment is stripped from the visible markdown before rendering.

Metrics display:
- Time as `Xs` (< 1 min) or `Xm Ys` (≥ 1 min)
- Cost as `$0.0000` (four decimal places)
- Token counts as `X,XXX in / Y,YYY out`

## Why

The time metric makes it easy to spot which phase (initial run, follow-up, type-fix) is slowest. Per-section costs make it immediately clear where API spend is concentrated.
