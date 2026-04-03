# Add abort button for running Claude Code sessions

## What changed

- **`lib/evolve-sessions.ts`**: Added an in-memory `activeClaudeAbortControllers` registry (mirroring the existing `activeDevServerProcesses` map). Both `startLocalEvolve` and `runFollowupInWorktree` now register their `AbortController` under the session ID while Claude is running and unregister it when done. A new exported `abortClaudeRun(sessionId)` function signals the abort and returns `true` if a running instance was found. User-aborted runs append a `🛑 **Claude Code was aborted.** Moving to ready state with work completed so far.` message and transition to `ready` (same behaviour as the existing 20-minute timeout path).

- **`app/api/evolve/abort/route.ts`** (new): `POST /api/evolve/abort` — validates auth, looks up the session, rejects with 409 if the session is not in `running-claude` or `starting` state, then calls `abortClaudeRun()`. The session transitions to `ready` asynchronously as the abort propagates through the `query()` loop.

- **`components/EvolveSessionView.tsx`**: When `isClaudeRunning` is true, the Available Actions panel header now shows an **⏹ Abort** button instead of "Accept & Reject available once Claude finishes". Clicking it POSTs to `/api/evolve/abort` and resumes SSE streaming to catch the `ready` transition. Abort errors surface inline below the panel header.

## Why

Users had no way to stop a Claude Code run that was going in the wrong direction, took too long, or was started by mistake. The only options were to wait for the 20-minute timeout or reject the entire session after it finished. The abort button lets users cut a run short at any point and immediately review, follow up on, accept, or reject the partial work.
