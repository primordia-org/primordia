# Derive session page from NDJSON log when not in DB

## What changed

Added a fallback path in the session page and SSE stream endpoint so that sessions missing from the local database can still be viewed, as long as their NDJSON log file exists on disk.

### New helpers in `lib/session-events.ts`

- **`getCandidateWorktreePath(sessionId)`** — derives the expected worktree directory path for a given session ID using the flat worktree layout convention (all worktrees are siblings under the same parent directory as the current one).

- **`deriveSessionFromLog(id, worktreePath)`** — reads the `.primordia-session.ndjson` log from the given path and reconstructs a synthetic `EvolveSession` record from it. Extracts:
  - `request` from `initial_request` event
  - `createdAt` from the first timestamped event
  - `status` from `result` / `decision` events (defaults to `'ready'`)
  - Token usage and cost from `metrics` event

### Updated `app/evolve/session/[id]/page.tsx`

After a failed DB lookup, the page now calls `deriveSessionFromLog` with the candidate worktree path. If a log is found, the session is reconstructed and the page renders normally. Only if both the DB and the log are absent does the page 404.

### Updated `app/api/evolve/stream/route.ts`

Same fallback applied in the SSE polling loop: if the session is not in the DB, attempt log-based reconstruction before reporting "Session not found". Since a log-derived session has no running worker, it will already be in a terminal state, so the stream closes immediately after delivering events.

### Updated `components/EvolveSessionView.tsx`

The **⬆ Upstream Changes** box is now gated on `canAcceptReject` in addition to `canEvolve`. When viewing a session where `branch === sessionBranch` (e.g. viewing your own current branch's session from within that worktree), the box would nonsensically display "`session-logs-without-db` is 1 commit ahead of `session-logs-without-db`". Since you can only apply upstream updates to sessions you can accept/reject, gating on `canAcceptReject` prevents this message from appearing.

## Why

The database in each worktree is a copy taken at the moment the worktree was created. Sessions that ran in parent or sibling worktrees after that point are invisible to the local DB. The NDJSON log file lives inside the worktree directory itself, so it persists independently of the DB. This change lets us view those "invisible" sessions directly from the URL (`/evolve/session/<branch-name>`) by deriving everything we need from the log.
