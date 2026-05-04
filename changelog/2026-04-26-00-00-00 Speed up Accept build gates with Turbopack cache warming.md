# Speed up Accept build gates with Turbopack cache warming

## What changed

Three coordinated changes to pre-warm the Turbopack persistent filesystem cache so that the mandatory build gate that runs when a user clicks **Accept** completes much faster:

### 1. `package.json` — run build under Bun's runtime

Changed the `build` script from `next build` to `bun run --bun next build`.

Running `next build` under Bun's runtime (via `--bun`) is required for `bun:sqlite` to resolve correctly inside Turbopack's worker threads. Without this flag, Turbopack-built production bundles that reference `bun:sqlite` can fail in the worker sub-processes that compile server components.

### 2. `next.config.ts` — enable `turbopackFileSystemCacheForBuild`

Added `experimental.turbopackFileSystemCacheForBuild: true`.

This tells Next.js to persist the Turbopack compilation cache to `.next/cache/turbopack/` between `next build` invocations (previously Turbopack only cached between `next dev` reloads). With a warm cache, subsequent builds skip re-compiling unchanged modules and are substantially faster.

### 3. `lib/evolve-sessions.ts` — background cache-warming build after Claude finishes

After a session's agent worker exits (i.e. the session transitions to `ready`), a new helper `spawnCacheWarmBuild()` is called with `void` (fire-and-forget). It spawns:

```
nice -n 19 sh -c 'ionice -c 3 bun run --bun next build || bun run --bun next build'
```

in the session worktree as a fully detached background process (`detached: true`, `stdio: 'ignore'`, `proc.unref()`).

- **`nice -n 19`** — lowest CPU scheduling priority, so the warm-up build yields to everything else on the server.
- **`ionice -c 3`** — idle I/O class (Linux only). The `|| bun run --bun next build` fallback ensures the build still runs on macOS or kernels where `ionice` is unavailable.
- The process is detached so it never blocks the main session pipeline, the dev server startup, or the Next.js API route event loop.

By the time the user has reviewed the preview and clicks **Accept**, the Turbopack cache is already warm and the Accept build gate runs in a fraction of the time it would otherwise take.

## Why

The Accept flow includes a mandatory `bun run build` gate before deploying to production. On a cold cache, a full Turbopack build can take 30–90 seconds. Cache warming turns subsequent builds into incremental compiles (seconds), significantly improving the user experience when accepting an evolve session.
