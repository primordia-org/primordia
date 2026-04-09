# Guard against concurrent prod deploys

## What changed

- **`lib/evolve-sessions.ts`**: Added `'accepting'` to the `LocalSessionStatus` union type. It was already being written to SQLite by the manage route but was missing from the type definition.

- **`app/api/evolve/manage/route.ts`**: Three changes:
  1. Added Gate 3 — a concurrent-deploy guard — immediately before `runAcceptAsync` is kicked off. After Gates 1 (ancestor check) and 2 (clean worktree), the handler now queries all evolve sessions and returns **409 Conflict** if any other session has `status === 'accepting'`. The 409 body includes the branch name of the in-progress deploy so the user knows what to wait for.
  2. Added `markInterruptedSessions` helper: called in both `runAcceptAsync` and `retryAcceptAfterFix` immediately before the final `copyDb` + `spawnProdViaProxy` step. It scans all sessions and marks any `running-claude`, `fixing-types`, or `starting` sessions (other than the one being accepted) as `ready` with an error note explaining they were interrupted by the deploy. This ensures the new slot's DB reflects the true state rather than leaving those sessions stuck in a running status forever.
  3. Added `import type { DbAdapter }` to support typing the new helper.

- **`PRIMORDIA.md`**: Updated the session state machine reference to formally document `accepting` as a status, explain the 409 semantics, and add the `ready → accepting → accepted/ready(error)` transition rows.

## Why

**The race condition:** Two users (or one user with two browser tabs) could click Accept on two different `ready` sessions at roughly the same time. Both sessions would pass Gates 1 and 2 synchronously, both would set their status to `accepting`, and both would eventually call `spawnProdViaProxy`. The second call to the proxy would overwrite the first deploy: it would set `primordia.productionBranch` to the second session's branch, which was built from the **old** production code (not from the first deploy). The net effect is that the first deploy's changes are silently discarded.

**What happens to Claude Code sessions running during a prod deploy?** They are terminated. When `spawnProdViaProxy` fires, the reverse proxy SIGTERMs the old production server — and any `query()` calls still running inside that process die with exit code 143. The catch block in `startLocalEvolve` may attempt to write an error back to SQLite, but it writes to the **old slot's DB**, not the new one. Because the final `copyDb` is taken before the SIGTERM, the new slot's DB would otherwise show those sessions stuck in `running-claude` indefinitely, with no active process behind them. `markInterruptedSessions` fixes this by writing the error state into the old slot's DB before the final snapshot, so the copy that the new server loads already shows `ready` + error for those sessions. Users can then continue with a follow-up request.

**Why a 409 (not a lock)?** A full distributed lock would add complexity for a single-process app. Since `bun:sqlite` queries run on the same thread and the `accepting` status is written atomically before the async work starts, a simple "any session in `accepting`?" check is sufficient to block the common cases: accidental concurrent accepts from two browser sessions, or a second accept submitted before the first deploy finishes (which takes ~60–90 s for typecheck + build + proxy spawn).
