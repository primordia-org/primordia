# Simplify thinking display

## What changed
- Label changed from "🧠 Extended reasoning" to "🧠 Thinking"
- Removed estimated token count `(N est. tokens)` from the summary line
- Removed special purple color styling; thinking blocks now use the same neutral gray as tool call blocks
- Added `inline-block` to the caret `<span>` so the rotate-90 transition animates properly (matching tool call behavior)
- Removed the "thinking..." animated pulse and "Awaiting reasoning tokens..." placeholder text in favor of a simple "Thinking..." fallback

## Why
The previous thinking block was visually noisy: a redundant "Extended reasoning" label, estimated token counts that aren't actionable, and a bright purple color that drew too much attention. The simplified version is quieter and consistent with how tool calls are displayed.
