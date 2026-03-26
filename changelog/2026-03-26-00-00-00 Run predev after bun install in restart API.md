# Run `bun run predev` after `bun install` in restart API

## What changed

In `app/api/evolve/local/restart/route.ts`, added a `bun run predev` step immediately after `bun install` and before the Next.js dev-server restart call.

## Why

`bun run predev` runs `scripts/generate-changelog.mjs`, which regenerates two build artifacts:

- `public/changelog.json` — the changelog data served to the `/changelog` page
- `lib/generated/system-prompt.ts` — the static chat system prompt with the last 30 changelog filenames baked in

When a local evolve session is accepted and the branch is merged, the worktree's new `changelog/*.md` file is now part of the main repo. Without re-running `predev`, the restarted dev server would serve stale changelog data and a stale system prompt that doesn't know about the newly merged change. Running `predev` here ensures the rebuilt artifacts are in place before Next.js restarts.
