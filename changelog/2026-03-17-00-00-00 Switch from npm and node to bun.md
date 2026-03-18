# Switch from npm/node to bun

## What changed
- `package.json`: prebuild/predev scripts now invoke `bun` instead of `node` to run `scripts/generate-changelog.mjs`
- `scripts/generate-changelog.mjs`: shebang updated from `#!/usr/bin/env node` to `#!/usr/bin/env bun`; inline comment updated to reference `bun run predev`
- `lib/local-evolve-sessions.ts`: the spawned dev server process now uses `bun run dev` instead of `npm run dev`; comments updated accordingly
- `README.md`: local dev setup instructions updated from `npm install` / `npm run dev` to `bun install` / `bun run dev`
- `PRIMORDIA.md`: architecture data-flow diagram updated to reference `bun run dev`
- `.gitignore`: added `bun-debug.log*` and `bun-error.log*` alongside the existing npm/yarn debug log ignores

## Why
Bun is significantly faster than npm for both installs and script execution, reducing cold-start times for local evolve sessions and CI runs.
