# Fix deploy stuck due to Next.js build lock conflict

## What changed

### Prevent the lock conflict (original fix)
- **`app/api/evolve/manage/route.ts`** — `runAcceptAsync` now kills the preview dev server and any background cache-warming build before running `install.sh`. Previously this was only done in `retryAcceptAfterFix` but not in the initial accept path.
- **`lib/evolve-sessions.ts`** — `spawnCacheWarmBuild` now writes the warmup process PID to `.primordia-warmup-build.pid` in the worktree so `runAcceptAsync` can kill it reliably.

### Fix the stuck-forever / no-STUCK?-button problem (follow-up fix)
- **`app/api/evolve/manage/route.ts`** — `runInstallSh` now resolves on the `'exit'` event (when the main bash process exits) instead of `'close'` (when all stdio streams close). After resolving, it immediately destroys the stdout/stderr streams.
- **`scripts/install.sh`** — Added `_spin_kill` before `exit 1` in the typecheck and build failure paths.

## Why

### The build lock conflict

When a session becomes ready, two things happen in parallel:

1. The **preview dev server** starts (`bun run dev`) to let the user browse the changes.
2. A **background cache-warming build** (`spawnCacheWarmBuild`) runs `bun run --bun next build` at idle priority to pre-warm the Turbopack cache so the real production build is faster.

Next.js uses a build lock to prevent two builds running simultaneously. When the user clicks **Accept**, `runAcceptAsync` immediately called `runInstallSh` which runs `bun run build` — but if the cache-warming build was still in progress, Next.js detected the lock and refused:

```
× Another next build process is already running
error: "next" exited with code 1
```

### Why the session stayed stuck and the STUCK? button never appeared

`install.sh`'s `_step` function spawns a spinner animation as a background subshell (`( ... ) &` + `disown`). That spinner inherits the stdout/stderr pipe write-ends from install.sh. When install.sh calls `exit 1` on build failure:

- The main bash process exits (code 1).
- But the spinner subshell is still running and **holds the pipe write FDs open**.
- Node.js's `'close'` event only fires when **all** stdio streams are closed — the spinner keeps them open, so `'close'` never fires.
- `runInstallSh` therefore **never resolves** — the `await` in `runAcceptAsync` hangs forever.
- `failWithError` is never called, so no `result:error` event is written to the NDJSON log.
- `inferStatusFromEvents` keeps returning `'accepting'` (no result event to flip it to `'ready'`).
- The spinner process keeps writing `\r/ bun run build...` log_line events, which continuously reset the STUCK? button's 30-second inactivity timer — so the button never appears either.

The fix is to resolve `runInstallSh` on `'exit'` (fires as soon as the main bash process exits) and then destroy the streams (which closes the read ends, sending SIGPIPE to the spinner and killing it). `_spin_kill` is also added to install.sh's failure paths for belt-and-suspenders defence.
