# Inject PRIMORDIA.md into chat system prompt statically at build time

## What changed

- `scripts/generate-changelog.mjs` now additionally generates `lib/generated/system-prompt.ts` — a TypeScript module that exports the full `SYSTEM_PROMPT` string with PRIMORDIA.md and the last 30 changelog filenames baked in at build time.
- `app/api/chat/route.ts` now imports `SYSTEM_PROMPT` from `@/lib/generated/system-prompt` instead of reading from the filesystem at runtime.
- `lib/generated/` added to `.gitignore` (build artifact).
- `PRIMORDIA.md` updated to document the new `lib/generated/system-prompt.ts` artifact and clarify the build-time generation flow.

## Why

In chat mode, Primordia was prone to hallucination when users asked about its own architecture — it had no grounding information about itself. By baking PRIMORDIA.md and the last 30 changelog filenames into the system prompt at build time (via `scripts/generate-changelog.mjs`), the assistant can answer accurately about how the app works, what technologies it uses, and what has been changed, without inventing details. Using a static import (instead of reading files at runtime) means the prompt is bundled into the Next.js route at build time with no filesystem access needed at runtime.
