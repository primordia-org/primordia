# Separate session status from dev server status

## What changed

Refactored the session state model to cleanly separate two independent dimensions that were previously conflated in the single `LocalSessionStatus` type:

### Before

`LocalSessionStatus` was a compound type mixing session lifecycle states with dev server states:

```
'starting' | 'running-claude' | 'starting-server' | 'ready' | 'accepted' | 'rejected' | 'disconnected' | 'error'
```

The `'starting-server'`, `'ready'`, and `'disconnected'` states all encoded dev server information inside the session status.

### After

**`LocalSessionStatus`** — session pipeline lifecycle only:
```
'starting' | 'running-claude' | 'ready' | 'accepted' | 'rejected' | 'error'
```

**`DevServerStatus`** — dev server state only:
```
'none' | 'starting' | 'running' | 'disconnected'
```

### Mapping

| Old combined status | New session status | New dev server status |
|---|---|---|
| `starting` | `starting` | `none` |
| `running-claude` | `running-claude` | `none` |
| `starting-server` | `ready` | `starting` |
| `ready` | `ready` | `running` |
| `disconnected` | `ready` | `disconnected` |
| `accepted` / `rejected` / `error` | unchanged | (unchanged) |

### Files changed

- **`lib/local-evolve-sessions.ts`**: New `DevServerStatus` type; `devServerStatus` field added to `LocalSession`; all state transitions updated.
- **`lib/db/types.ts`**: `EvolveSession.devServerStatus` field added; `updateEvolveSession` signature updated.
- **`lib/db/sqlite.ts`**: `dev_server_status` column added to `evolve_sessions` table (with `ALTER TABLE` migration for existing DBs); all CRUD methods updated.
- **`app/api/evolve/local/route.ts`**: POST returns `devServerStatus: 'none'` on session creation; GET returns `devServerStatus` in response.
- **`app/api/evolve/local/kill-restart/route.ts`**: Status check updated to use `devServerStatus`; immediate update sets `devServerStatus: 'starting'`.
- **`app/api/evolve/local/followup/route.ts`**: Session construction includes `devServerStatus`.
- **`components/EvolveSessionView.tsx`**: `devServerStatus` state tracked separately; polling terminal condition, UI banners, and disconnect/restart logic all updated.
- **`app/evolve/session/[id]/page.tsx`**: `initialDevServerStatus` prop passed to `EvolveSessionView`.
- **`PRIMORDIA.md`**: State machine diagram and reference tables updated to reflect the two-dimensional model.

---

## Follow-up: Infer dev server status instead of persisting it

### What changed

`DevServerStatus` is no longer saved to SQLite. Instead it is computed on every read using the following strategy:

- **Port not yet known (`port === null`) and a dev server process is registered in the in-process map** → `'starting'`
- **Port not yet known and no process registered** → `'none'`
- **Port known, `lsof -ti :<port>` exits 0** → `'running'`
- **Port known, `lsof -ti :<port>` exits non-zero** → `'disconnected'`

An in-memory `Map<sessionId, ChildProcess>` (`activeDevServerProcesses`) is maintained in `lib/local-evolve-sessions.ts`. Processes are registered when spawned and deleted when the process emits a `close` event.

During a dev server restart (`kill-restart` route), `port` is reset to `null` in SQLite before the old process is killed. This ensures the inferred status transitions `disconnected → starting → running` rather than briefly getting stuck on `disconnected` (which would stop the UI's polling loop).

### Files changed (follow-up)

- **`lib/local-evolve-sessions.ts`**: Added `activeDevServerProcesses` map and exported `inferDevServerStatus()`. Removed `devServerStatus` from all `persist()` payloads. Processes registered/deregistered around dev server lifecycle. `restartDevServerInWorktree` now resets `port` to `null` before killing the old process.
- **`lib/db/types.ts`**: Removed `devServerStatus` from `EvolveSession` and from `updateEvolveSession` signature.
- **`lib/db/sqlite.ts`**: Removed `dev_server_status` from `createEvolveSession` INSERT, `updateEvolveSession`, `getEvolveSession`, and `listEvolveSessions`. The column remains in the DB schema (harmless; existing rows retain their old value).
- **`app/api/evolve/local/route.ts`**: GET handler now calls `inferDevServerStatus(sessionId, session.port)` instead of reading `session.devServerStatus` from SQLite.
- **`app/api/evolve/local/kill-restart/route.ts`**: Removed explicit `devServerStatus: 'starting'` DB update; inference handles it.
- **`app/api/evolve/local/followup/route.ts`**: Removed `devServerStatus` from DB-to-session reconstruction.
- **`app/evolve/session/[id]/page.tsx`**: Uses `inferDevServerStatus()` for the `initialDevServerStatus` prop.

### Why

SQLite persisted `devServerStatus` was always slightly stale — it reflected what the server thought at the last write, not what was actually happening. The OS knows the ground truth: either `lsof` finds a process on the port, or it doesn't. Replacing persistence with live inference means the status is always accurate, survives server restarts, and removes an entire class of "stuck in disconnected" bugs caused by missed state transitions.

## Why

The old `LocalSessionStatus` was a leaky abstraction — it mixed "what is the Claude pipeline doing?" with "what is the preview dev server doing?", making the state machine harder to reason about and diagram. For example, `'disconnected'` meant the server crashed but Claude was long done; `'starting-server'` meant Claude was done but the server wasn't up yet. These are orthogonal concerns.

By separating them, each dimension is independently comprehensible. The session status tells you where Claude/the pipeline is; the dev server status tells you whether the preview is accessible. This also makes the state machine diagram simpler and more accurate.
