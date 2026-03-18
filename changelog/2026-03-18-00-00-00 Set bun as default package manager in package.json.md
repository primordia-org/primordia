# Set bun as default package manager in package.json

Added `"packageManager": "bun@1.2.0"` to `package.json`.

## What changed
- `package.json` now declares `"packageManager": "bun@1.2.0"`.

## Why
The project already uses bun throughout (scripts invoke `bun`, the local evolve flow spawns `bun run dev`, and the previous changelog entry switched from npm/node to bun). Declaring `packageManager` makes this explicit and machine-readable: Node.js Corepack can enforce the correct package manager version, and tooling (editors, CI, Vercel) can detect bun automatically without extra configuration.
