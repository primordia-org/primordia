# Skip typecheck and build when merging into dev branch

## What changed

In `app/api/evolve/manage/route.ts`, Gates 3 (TypeScript typecheck) and 4 (production build) inside `runAcceptAsync` are now skipped when `NODE_ENV !== 'production'`.

Previously, `bun run typecheck` and `bun run build` ran unconditionally before every accept — including in the faster dev pipeline path where the branch is simply merged into a dev branch. This caused two problems:

- `bun run build` is a full production Next.js build; running it on every local merge is slow and unnecessary.
- In development environments the build can fail for reasons unrelated to the code change (missing env vars, platform differences, etc.), blocking the merge entirely.

## Why

The typecheck and build gates exist to ensure the code is deployable to production before the blue/green slot swap. They are only meaningful on production. On a local dev server the merge goes directly into a dev branch with no production deploy, so these gates add cost with no benefit.

The fix moves `const isProduction` to the top of the try block and wraps Gates 3 and 4 inside `if (isProduction)`, leaving the blue/green and faster dev pipeline merge paths unchanged.
