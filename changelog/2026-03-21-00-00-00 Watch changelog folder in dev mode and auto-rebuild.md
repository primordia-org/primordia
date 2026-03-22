# Watch changelog folder in dev mode and auto-rebuild

## What changed

- Added `scripts/watch-changelog.mjs` — a lightweight dev-mode watcher that uses Node's built-in `fs.watch` to monitor the `changelog/` directory for new or modified `.md` files.  When a change is detected it re-runs `scripts/generate-changelog.mjs` (with a 150 ms debounce) so `public/changelog.json` and `lib/generated/system-prompt.ts` are refreshed without restarting the dev server.
- Updated the `dev` script in `package.json` from `next dev` to `bun scripts/watch-changelog.mjs & next dev`, so the watcher starts automatically alongside `next dev`.

## Why

Previously, adding a new file to `changelog/` during a dev session required manually re-running `bun run predev` (or restarting the dev server) to see the updated changelog page and to get the new entry baked into the system prompt.  The watcher makes this automatic: drop a file in `changelog/`, and the generated artifacts update instantly.

No new npm dependencies were introduced — the watcher uses only Node built-in APIs (`fs.watch`, `child_process.spawnSync`).
