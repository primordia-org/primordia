# Simplify thinking display

## What changed
- Label changed from "🧠 Extended reasoning" to "🧠 Thinking"
- Removed estimated token count `(N est. tokens)` from the summary line
- Removed special purple color styling; thinking blocks now use the same neutral gray as tool call blocks
- Added `inline-block` to the caret `<span>` so the rotate-90 transition animates properly
- Used Tailwind named group (`group/thinking` / `group-open/thinking:rotate-90`) so the caret rotation responds to the thinking `<details>` open state rather than an ancestor `group` — fixes broken animation when thinking blocks are nested inside the "tool calls made" collapsible
- Removed the "thinking..." animated pulse and "Awaiting reasoning tokens..." placeholder text in favor of a simple "Thinking..." fallback

## Why
The previous thinking block was visually noisy: a redundant "Extended reasoning" label, estimated token counts that aren't actionable, and a bright purple color that drew too much attention. The simplified version is quieter and consistent with how tool calls are displayed.

- Streaming label changed to "🧠 Thinking..."; once the block is complete it shows "🧠 Thought for Xs" (or "Xm Ys" for longer runs)
- `mergeConsecutiveTextEvents` now tracks `endTs` on merged thinking events so the duration can be computed from the first-delta timestamp to the last-delta timestamp
