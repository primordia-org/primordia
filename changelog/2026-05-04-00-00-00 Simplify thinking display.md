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

## Also fixed: hard-coded model list to remove pi import from SSR path
- `lib/agent-config.ts` now exports a hard-coded `MODEL_OPTIONS` record (10 models across claude-code and pi harnesses) instead of relying on `@mariozechner/pi-coding-agent`'s `ModelRegistry` at runtime
- `app/api/evolve/models/route.ts` now returns `MODEL_OPTIONS` directly — no pi SDK import
- `lib/user-prefs.ts` now validates saved model preferences against `MODEL_OPTIONS` inline — no pi SDK import
- `lib/evolve-sessions.ts` now resolves model labels via an inline lookup against `MODEL_OPTIONS` — no pi SDK import
- `lib/pi-model-registry.server.ts` is kept for reference but is no longer imported anywhere

`@mariozechner/pi-coding-agent` is ESM-only. Turbopack handles ESM externals by creating content-hashed symlinks in `.next/dev/node_modules/`. In fresh worktrees the symlinks may not exist when the first SSR render fires, causing `externalImport('@mariozechner/pi-coding-agent-{hash}')` to fail. Removing the static import from every server-component code path eliminates the failure.
