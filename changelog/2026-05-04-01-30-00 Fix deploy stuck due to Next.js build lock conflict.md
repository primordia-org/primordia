# Fix deploy stuck due to Next.js build lock conflict

## What changed

- **`app/api/evolve/manage/route.ts`** — `runAcceptAsync` now kills the preview dev server and any background cache-warming build before running `install.sh`. Previously this was only done in `retryAcceptAfterFix` but not in the initial accept path.
- **`lib/evolve-sessions.ts`** — `spawnCacheWarmBuild` now writes the warmup process PID to `.primordia-warmup-build.pid` in the worktree so `runAcceptAsync` can kill it reliably.

## Why

When a session becomes ready, two things happen in parallel:

1. The **preview dev server** starts (`bun run dev`) to let the user browse the changes.
2. A **background cache-warming build** (`spawnCacheWarmBuild`) runs `bun run --bun next build` at idle priority to pre-warm the Turbopack cache so the real production build is faster.

Next.js uses a build lock (`.next/build-lock`) to prevent two builds running simultaneously. When the user clicks **Accept**, `runAcceptAsync` immediately called `runInstallSh` which runs `bun run build` — but if the cache-warming build was still in progress, Next.js detected the lock and refused:

```
× Another next build process is already running
error: "next" exited with code 1
```

This caused the deploy to fail permanently (the session stayed stuck in `accepting` with the error shown in the deploy log). The dev server itself can also hold the build lock in some Next.js versions.

The fix ensures both competing processes are terminated (with a 2-second grace period) before the production build runs.
