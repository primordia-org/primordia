# Persist evolve sessions in SQLite with dedicated session page

## What changed

### SQLite persistence for evolve sessions

- Added `EvolveSession` interface to `lib/db/types.ts` and extended `DbAdapter` with four new methods: `createEvolveSession`, `updateEvolveSession`, `getEvolveSession`, `listEvolveSessions`.
- Added `evolve_sessions` table to `lib/db/sqlite.ts` (columns: `id`, `branch`, `worktree_path`, `status`, `progress_text`, `port`, `preview_url`, `request`, `created_at`). Implemented all four adapter methods.
- `LocalSession` in `lib/local-evolve-sessions.ts` gained two new fields: `request` (the user's original prompt) and `createdAt` (Unix ms timestamp).
- Added `persistSessionAsync(session, force?)` helper in `local-evolve-sessions.ts`: fire-and-forget write to SQLite, throttled to ≤1 write per 2 seconds per session (bypassed with `force = true` for status changes). Called at every major milestone: worktree creation, `bun install`, Claude Code start, each assistant message (throttled), Claude finish, server starting, server ready, disconnected.

### API changes

- `POST /api/evolve/local` now writes an initial `EvolveSession` record to SQLite immediately after creating the in-memory session, so the session page can SSR the initial state.
- `GET /api/evolve/local?sessionId=...` first checks the in-memory map (active sessions with a live `ChildProcess`), then falls back to SQLite for completed or historically persisted sessions. The response now also includes `request`.

### New session page

- Added `components/EvolveSessionView.tsx`: a `"use client"` component that receives initial session state as props and polls `/api/evolve/local?sessionId=...` every 5 seconds until the session reaches a terminal state (`ready`, `error`, or `disconnected`). Shows the original request, live progress rendered as Markdown, and a preview link when ready.
- Added `app/evolve/session/[id]/page.tsx`: a server component that authenticates the user, reads the initial session from SQLite, and renders `EvolveSessionView` with SSR'd initial data.

### EvolveForm simplified

- `components/EvolveForm.tsx` now just renders the input form. On submit it POSTs to `/api/evolve/local`, then calls `router.push('/evolve/session/{sessionId}')` to redirect. All in-page polling, message list, and submitted-state rendering have been removed — that logic now lives exclusively in `EvolveSessionView`.

## Why

Previously, evolve sessions were stored only in an in-memory `Map`. This meant:
- Refreshing the `/evolve` page during a run lost all progress.
- The form had to stay mounted to maintain polling; navigating away killed it.
- There was no URL you could bookmark, share, or return to after a server restart.

Persisting sessions to SQLite gives each run a stable, shareable URL (`/evolve/session/{id}`) with full history, and lets the session page do server-side rendering of the initial state.
