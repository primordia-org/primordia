# Use bun runtime for build and start scripts

## What changed

Updated `package.json` to ensure both the `build` and `start` scripts explicitly use the bun runtime via the `--bun` flag:

- `build`: was `bun run --bun next build` ✅ (already correct)
- `start`: was `next start` → changed to `bun run --bun next start`

## Why

The `dev` script already used `bun run --bun next dev`, and `build` already had `--bun`, but `start` was invoking `next start` without the `--bun` flag. This meant the production server was running under Node.js instead of the bun runtime, creating an inconsistency between development and production environments. Standardising on `--bun` across all three scripts ensures consistent runtime behaviour and takes full advantage of bun's performance characteristics in production.
