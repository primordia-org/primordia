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

## Why

The old `LocalSessionStatus` was a leaky abstraction — it mixed "what is the Claude pipeline doing?" with "what is the preview dev server doing?", making the state machine harder to reason about and diagram. For example, `'disconnected'` meant the server crashed but Claude was long done; `'starting-server'` meant Claude was done but the server wasn't up yet. These are orthogonal concerns.

By separating them, each dimension is independently comprehensible. The session status tells you where Claude/the pipeline is; the dev server status tells you whether the preview is accessible. This also makes the state machine diagram simpler and more accurate.
