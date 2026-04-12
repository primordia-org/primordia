# Eliminate `evolve_sessions` SQLite table in favor of git and filesystem

## What changed

The `evolve_sessions` SQLite table has been removed entirely. Session state is now stored in small files inside each worktree and read directly from git config and the existing NDJSON event log.

### New filesystem state files (per session worktree)

| File | Purpose |
|------|---------|
| `.primordia-status` | Current session status (plain text: `starting`, `running-claude`, `ready`, `accepted`, etc.) |
| `.primordia-preview-url` | Preview URL when the session is ready (absent = null) |
| `.primordia-branch` | Branch name (for from-branch sessions where branch ≠ session ID; absent = session ID) |
| `.primordia-session.ndjson` | Structured event log (unchanged — always was the authoritative record) |

Port is read from git config `branch.<name>.port` (was already stored there).
Request text, timestamps, and metrics are read from the NDJSON log (`initial_request` / `metrics` events).

### Code changes

- **`lib/session-events.ts`**: Added `readSessionStatus`, `writeSessionStatus`, `readSessionPreviewUrl`, `writeSessionPreviewUrl`, `readSessionBranch`, `writeSessionBranch`, `getSessionFromFilesystem`, and `listSessionsFromFilesystem` helpers.
- **`scripts/claude-worker.ts`**: Removed SQLite (`bun:sqlite`) dependency. Worker now writes `.primordia-status` and `.primordia-preview-url` files instead of calling `UPDATE evolve_sessions`.
- **`lib/evolve-sessions.ts`**: Removed `getDb()` usage. `persist()` now writes to filesystem files. `reconnectRunningWorkers()` uses `listSessionsFromFilesystem()`. Added `worktreeAlreadyCreated` option so the POST handlers can create the worktree synchronously before fire-and-forget.
- **All API routes** (`route.ts`, `manage`, `stream`, `abort`, `followup`, `diff`, `diff-summary`, `upstream-sync`, `attachment`, `kill-restart`, `from-branch`): Replaced `db.getEvolveSession/updateEvolveSession/createEvolveSession/listEvolveSessions` with the new filesystem functions.
- **`app/branches/page.tsx`**: Uses `listSessionsFromFilesystem()` instead of `db.listEvolveSessions()`.
- **`app/evolve/session/[id]/page.tsx`**: Uses `getSessionFromFilesystem()` instead of `db.getEvolveSession()`.
- **`lib/db/sqlite.ts`**: Removed `evolve_sessions` table creation, all migrations for that table, and all four CRUD method implementations.
- **`lib/db/types.ts`**: Removed `createEvolveSession`, `updateEvolveSession`, `getEvolveSession`, `listEvolveSessions` from the `DbAdapter` interface. The `EvolveSession` type itself is retained for use in UI components.

### Race-condition fix

Previously, the POST handler created the DB record synchronously and fired `startLocalEvolve()` async. Now the POST handler creates the git worktree synchronously (fast, ~100ms) and writes the initial status files before returning, so the session page is immediately reachable with no race window.

## Why

The SQLite `evolve_sessions` table was the only remaining obstacle to treating git + filesystem as the sole source of truth. Eliminating it means:

- No more schema migrations or VACUUM INTO cleanup when copying the DB to child worktrees
- Session state survives across server restarts without any DB — just the worktree on disk
- Simpler reasoning: "the session exists if the worktree exists and has a `.primordia-status` file"
- The NDJSON log was already the authoritative event record; this change makes the status file the authoritative status record, removing the dual-write inconsistency risk
