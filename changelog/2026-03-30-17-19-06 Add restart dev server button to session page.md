# Add restart dev server button to session page

## What changed

- **`components/EvolveSessionView.tsx`** — Added a "↺ Restart dev server" button in two places:
  - Inside the disconnected-state notice (yellow warning box) for sessions in `disconnected` status.
  - As a subtle secondary panel ("Preview not loading or responding?") for sessions in `ready` status — because a session can be marked ready even when the dev server isn't actually responding.
  In both cases, clicking the button calls `POST /api/evolve/local/kill-restart`, optimistically sets local status to `starting-server`, and resumes the 5-second status poll so the UI reflects live progress.

- **`app/api/evolve/local/kill-restart/route.ts`** _(new file)_ — A `POST` handler that:
  1. Loads the session from SQLite and validates it is in `disconnected` **or `ready`** status.
  2. Updates the session status to `starting-server` in SQLite immediately.
  3. Fire-and-forgets `restartDevServerInWorktree()`.

- **`lib/local-evolve-sessions.ts`** — Added `restartDevServerInWorktree()`:
  1. Uses `lsof -ti :<port>` to find and `SIGTERM` any process still holding the port, then waits 800 ms for the OS to release it.
  2. Re-spawns `bun run dev` in the worktree with `PORT=<original port>` so the existing `previewUrl` stays valid.
  3. Waits for Next.js to print "Ready", then sets status back to `ready` and persists to SQLite.
  4. Re-attaches the close-watcher so the session is marked `disconnected` again if the restarted server exits unexpectedly.
  5. On any failure, sets status to `error` and appends the error message to `progressText`.

## Why

When a worktree dev server crashes or is killed outside of the normal accept/reject flow, the session page showed a static warning with no way to recover without SSH access. Additionally, sessions can sometimes be marked `ready` in the database even when the dev server isn't actually responding (e.g. it crashed shortly after startup before the close-watcher fired). This change lets users restart the server directly from the browser with one click in both cases, without losing the branch or any of Claude's work.
