# Eliminate predev/prebuild step by building system prompt at runtime

## What changed

- **Removed** `scripts/generate-changelog.mjs` and `scripts/watch-changelog.mjs` — no longer needed.
- **Removed** `predev` and `prebuild` npm script hooks from `package.json`; the `dev` script no longer spawns the changelog watcher.
- **Removed** `lib/generated/` from `.gitignore` (the directory no longer exists).
- **Added** `lib/system-prompt.ts` — a plain TypeScript module that reads `PRIMORDIA.md` and the last 30 `changelog/` filenames at runtime (on each chat request) and returns the assembled system prompt string.
- **Updated** `app/api/chat/route.ts` to call `buildSystemPrompt()` from `lib/system-prompt.ts` instead of importing the statically-generated `SYSTEM_PROMPT` constant.
- Updated `PRIMORDIA.md` file map and changelog section to reflect the new architecture.

## Why

The previous approach required a codegen step (`generate-changelog.mjs`) to run before `bun run dev` or `bun run build`, producing a gitignored TypeScript file (`lib/generated/system-prompt.ts`). This meant:

1. A fresh clone or new worktree had no `lib/generated/` directory, causing an immediate TypeScript import error if the prebuild step was skipped or failed.
2. The dev server needed a parallel watcher process (`watch-changelog.mjs`) to regenerate the file whenever `changelog/` changed.
3. The build pipeline had an implicit dependency on a file that wasn't in git.

Since Primordia runs exclusively as `bun run dev` (no production build step on exe.dev), there's no benefit to baking the system prompt into a static file at startup. Reading `PRIMORDIA.md` and `changelog/` on each chat request is trivially fast (filesystem reads of a handful of small files) and eliminates the entire codegen layer.
