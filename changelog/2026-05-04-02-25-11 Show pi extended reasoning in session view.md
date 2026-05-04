# Show pi extended reasoning (hidden thinking) in session view

## What changed

When pi uses a model with extended thinking enabled (e.g. Claude 3.7 Sonnet with
reasoning), the model can spend 1–2 minutes generating internal reasoning tokens
before producing any visible text or tool calls. These tokens were completely
invisible: `pi-worker.ts` only listened for `text_delta` events, so the session
page appeared frozen with zero activity during the entire reasoning phase.

### Changes

**`lib/session-events.ts`**
- Added a new `{ type: 'thinking'; content: string; ts: number }` event to the
  `SessionEvent` union. Thinking events are streamed progressively as the model
  reasons, just like text events.

**`scripts/pi-worker.ts`**
- Handle `thinking_start` from the pi SDK: emit an empty `thinking` event as a
  start-of-block marker so the UI can immediately show "Reasoning in progress..."
  even before any tokens arrive.
- Handle `thinking_delta`: stream each reasoning token chunk as a `thinking` event
  appended to the NDJSON log — visible in real time in the session view.
- Handle `thinking_end`: clear the in-thinking-block flag; no extra event needed.

**`app/evolve/session/[id]/EvolveSessionView.tsx`**
- Added `ThinkingBlock` component: a `<details>` collapsible element styled in
  purple that shows the model's reasoning content. Displays an animated
  "thinking..." label while streaming (empty content) and an estimated token count
  once content arrives.
- Extended `RenderableEvent` type to include `thinking` events.
- Extended `mergeConsecutiveTextEvents` to also merge consecutive `thinking`
  events (avoids per-delta re-renders; same pattern as text merging).
- Extended `splitAgentEventsForDisplay` to include `thinking` and `log_line`
  events in both detail and final sections.
- Render `ThinkingBlock` in `RunningAgentSection` (live stream with
  `isStreaming` flag) and `DoneAgentSection` (collapsed in tool-calls section
  and in final-answer section).

## Why

The 2-minute silence confused users into thinking pi was stuck or broken. In
reality the model was actively reasoning — just not logging anything. Now the
reasoning is streamed progressively and shown in a collapsible purple block
clearly labelled "🧠 Extended reasoning". Users can expand it to read the
model's chain of thought, or leave it collapsed if they only care about the
final output.
