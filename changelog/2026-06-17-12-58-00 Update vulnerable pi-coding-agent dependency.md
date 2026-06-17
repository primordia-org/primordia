# Update vulnerable pi-coding-agent dependency

## What changed

Migrated from `@mariozechner/pi-coding-agent@0.73.1` to `@earendil-works/pi-coding-agent@0.79.4`.

All import statements across the codebase were updated:
- `scripts/pi-worker.ts`
- `app/api/evolve/route.ts`
- `lib/pi-model-registry.server.ts`
- `scripts/regenerate-model-registry.ts`

The `serverExternalPackages` list in `next.config.ts` was updated to reflect the new package scope (`@earendil-works/pi-*` sub-packages, `jiti` instead of the old `@mariozechner/jiti`). The `@mariozechner/clipboard` optional dependency is still retained as it is used by the new package.

## Why

`bun audit` reported a low-severity vulnerability in `@mariozechner/pi-coding-agent`:
- **GHSA-7v5m-pr3q-6453**: Potential XSS in HTML session exports via Markdown URL sanitization bypass (affects versions `>= 0.27.5, <= 0.73.1`)

No patched version was released under the `@mariozechner/` scope. The package was instead renamed to `@earendil-works/pi-coding-agent` starting at version `0.74.0`, with the XSS fix included in `>= 0.78.1`. Version `0.79.4` is the newest release that satisfies the project's 24-hour minimum release age policy (`bunfig.toml`).
