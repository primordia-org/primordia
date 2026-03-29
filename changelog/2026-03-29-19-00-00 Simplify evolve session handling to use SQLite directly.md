# Simplify evolve session handling to use SQLite directly

## What changed

- **Removed the in-memory `sessions` Map** from `lib/local-evolve-sessions.ts`. Previously, active sessions were stored in a module-level `Map<string, LocalSession>` and periodically synced to SQLite via a throttled `persistSessionAsync` helper.

- **Removed `persistSessionAsync` and the `_lastDbFlush` throttle Map.** All session state is now written to SQLite directly via `await db.updateEvolveSession(...)` inside `startLocalEvolve`. Since `bun:sqlite` is synchronous under the hood, these writes are fast and no throttling is needed.

- **Removed `devServerProcess` from the `LocalSession` interface.** The spawned dev server process is now a local variable inside `startLocalEvolve`, since it was only ever used within that function.

- **Removed the `killDevServer` export.** Dev server cleanup is handled internally within `startLocalEvolve`'s error catch block.

- **Error handling moved into `startLocalEvolve`.** Previously, errors propagated out and were caught in a `.catch()` handler in `route.ts` which mutated the in-memory session object without persisting to DB. Now `startLocalEvolve` wraps the entire flow in a try/catch, writes the error state to SQLite directly, and does not re-throw.

- **Simplified `app/api/evolve/local/route.ts` GET handler.** The hybrid lookup (in-memory first, then DB) is replaced by a direct SQLite read.

- **Updated `app/branches/page.tsx`** to load session info from SQLite (`db.listEvolveSessions()`) instead of the in-memory Map. `getBranchData` is now `async`.

## Why

The in-memory Map + periodic SQLite sync added complexity without benefit: SQLite writes are fast (bun:sqlite is synchronous), so there was no need for a cache layer. The dual-source-of-truth also had a latent bug: error messages appended to a session in the `route.ts` `.catch()` handler were never persisted to the DB (only visible in memory until the server restarted). Removing the Map simplifies reasoning about session state — SQLite is the single source of truth.
