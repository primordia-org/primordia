# Accept flow hardening: blue/green deploy, rollback, DB/env preservation

## What changed

### Accept flow gates (`app/api/evolve/manage/route.ts`)

The accept flow now has four pre-merge gates, run in order:

1. **Ancestor check** — session branch must include all commits from the parent branch.
2. **Clean worktree** — no uncommitted changes in the session worktree.
3. **TypeScript gate** — `bun run typecheck` must pass. If it fails, Claude is automatically invoked to fix the type errors (`fixing-types` state), then the accept is retried.
4. **Production build gate** *(new)* — `bun run build` must succeed. If it fails, Claude is automatically invoked to fix the build errors (same `fixing-types` self-healing state), then the accept is retried.

After all gates pass, the accept flow takes one of two paths depending on whether the blue/green infrastructure is set up:

**Blue/green path** (production — `primordia-worktrees/current` symlink exists):
1. `bun install --frozen-lockfile` in the session worktree (not the production directory)
2. Create a merge commit via git plumbing (`git commit-tree` + `git update-ref`) — no working-tree writes to the production directory
3. Detach the session worktree HEAD onto the merge commit
4. **Health-check the new slot** — start the production server (`bun run start`) on a temporary free port and verify it responds to HTTP. If the server doesn't respond within 30 s, the accept is aborted before any swap occurs.
5. **Atomic DB snapshot** — copy the production database into the new slot using SQLite's `VACUUM INTO`, which creates a consistent point-in-time snapshot that is safe to take while the live server is actively writing (replaces the previous `copyFileSync` approach, which had a race window)
6. Fix the `.env.local` symlink in the new slot to point directly to the main repo's copy (which is never deleted), preventing a broken symlink chain after the old slot is cleaned up
7. Atomically swap the `current` symlink from the old production slot to the session worktree
8. Keep the old slot as a `previous` symlink for fast rollback; clean up the slot from two accepts ago (if it was a worktree)
9. Delete the session branch ref
10. Fire-and-forget `sudo systemctl restart primordia` (500 ms delay to flush HTTP response)

### Fast rollback (`app/api/rollback/route.ts` + `scripts/rollback.ts`) *(updated)*

Admin-only API endpoint (unchanged interface):

- `GET /api/rollback` — returns `{ hasPrevious: boolean }`.
- `POST /api/rollback` — swaps `current` ↔ `previous` atomically, copies the production DB via `VACUUM INTO` (consistent snapshot), then fires `sudo systemctl restart primordia`.

**New: `bun run rollback` standalone script** (`scripts/rollback.ts`) — performs the identical rollback operation directly via bun, bypassing the HTTP server entirely. Use this when the server itself is broken or unresponsive and the API endpoint is not reachable. Requires SSH / direct terminal access; no authentication is checked.

**Legacy path** (local dev — no `current` symlink):
git merge → stash/pop → `bun install --frozen-lockfile` → worktree remove (unchanged from before)

The self-healing retry (`retryAcceptAfterFix`) re-runs **both** typecheck and build before merging — so a type-error fix that accidentally breaks the build is caught before it reaches main.

### Always-on evolve — `PRIMORDIA_EVOLVE` removed

The `PRIMORDIA_EVOLVE=true` environment-variable guard has been removed from all six evolve API routes. The evolve feature is now always available; access is still gated by RBAC.

### Blue/green infrastructure (`scripts/primordia.service`, `scripts/install-service.sh`)

- **`primordia.service`** — `WorkingDirectory` and `EnvironmentFile` now point at `/home/exedev/primordia-worktrees/current`.
- **`install-service.sh`** — on first install, creates `/home/exedev/primordia-worktrees/current` → `/home/exedev/primordia`.

## Why

**Blue/green:** After accepting a change, all build work happens in the session worktree (already fully built by Gate 4), then the `current` symlink is swapped atomically and the service restarts onto the new slot in a clean state. No build activity happens in the live production directory.

**Build gate:** TypeScript type-checking (`tsc --noEmit`) only verifies types — it doesn't run the full Next.js compiler. Adding a build gate catches import errors, missing exports, invalid JSX, and other build-time issues before they reach main.

**`bun install --frozen-lockfile` in the worktree:** Ensures the new slot is self-contained when an evolve branch adds or upgrades packages.

**Health check before swap:** Even though the build gate passes, a server might fail to start due to runtime issues (missing env var, startup crash, etc.). The health check catches these before the swap so a bad deploy never goes live. The accept is aborted cleanly if the new slot doesn't serve HTTP within 30 s.

The health check runs the new server on a **temporary free port** — the live production server on port 3000 keeps serving traffic throughout. The only downtime is the brief systemd restart at the end (~1–5 s). Zero-downtime would require a reverse proxy (nginx/caddy) in front of Next.js; that is overkill for this use case.

The health check also detects **early process exit**: if `bun run start` crashes immediately (exit code before any HTTP response), the check returns an error right away instead of waiting the full 30 s timeout.

**Atomic DB copy via VACUUM INTO:** The previous `copyFileSync` approach copied `.db`, `-wal`, and `-shm` files in three separate syscalls. Between those copies, the running server could write a new WAL entry, leaving the destination with a `.db` that was inconsistent with its `-wal` file. SQLite's `VACUUM INTO` takes a single read snapshot inside a transaction, producing a fully-checkpointed database file with no WAL companion — consistent regardless of concurrent writes.

**`bun run rollback` script:** If the newly-deployed server is broken and unresponsive, `POST /api/rollback` can't be reached. The standalone script performs the identical swap + restart directly on the server via SSH without requiring the app to be running.

**DB preservation on rollback:** Copying the live DB before swapping back ensures passkey registrations and sessions created since the last deploy are not lost when rolling back.

**Remove PRIMORDIA_EVOLVE:** The env var gate was redundant — RBAC already enforces who can call the evolve routes.
