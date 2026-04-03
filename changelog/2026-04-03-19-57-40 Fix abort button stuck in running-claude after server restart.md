# Fix: Abort button recovers sessions stuck in `running-claude` after server restart

## What changed

Modified `app/api/evolve/abort/route.ts` to handle the case where no in-memory
abort controller exists for a session that the database still shows as
`running-claude` or `starting`.

Previously, clicking **Abort** in this state returned:
> "No active Claude Code instance found for this session" (HTTP 409)

…and the session remained stuck forever with no way to recover it without
directly editing the database.

## Why it happened

The evolve pipeline runs `startLocalEvolve()` as a fire-and-forget async call.
The `AbortController` for each running Claude Code instance is stored only
in-memory (`activeClaudeAbortControllers` map in `lib/evolve-sessions.ts`).

If the Next.js dev server process restarts while a Claude Code session is
in-flight (e.g. after a crash, a manual `bun run dev` restart, or a code
change that triggers HMR), that in-memory map is wiped. SQLite, however,
retains the session row in its last-written state — which may still be
`running-claude` or `starting`.

## How it's fixed

When `abortClaudeRun()` returns `false` (no active controller) but the DB
record confirms the session is in `running-claude`/`starting`, the abort
endpoint now directly transitions the session to `ready` in SQLite, appending
a recovery notice to the progress log. This mirrors the existing user-abort
and timeout recovery paths in `startLocalEvolve()`, and lets the user proceed
with accept, reject, or a follow-up request on whatever work was completed
before the restart.
