# Fix session log truncation on refresh after merge

## What changed

Moved the final VACUUM INTO (DB copy into new slot) and systemd service restart to occur **after** the session is marked as `accepted` in both `runAcceptAsync` and `retryAcceptAfterFix`.

Previously the flow was:
1. `blueGreenAccept` copied the DB into the new slot (Step 4b) — before the session was finalized
2. `blueGreenAccept` scheduled `systemctl restart` with a 500 ms fire-and-forget delay
3. The caller (`runAcceptAsync` / `retryAcceptAfterFix`) wrote the final `✅ Accepted` log entry and set `status = 'accepted'`

Because step 1 happened before step 3, the DB snapshot in the new slot was always missing the final log entries and the `accepted` status. When systemd restarted, the new slot started with this stale snapshot, so refreshing the page after an accept would show the session stuck in "Accepting changes" with a truncated log ending at `Health-checking new slot…`.

## Why

SQLite is the source of truth for session state. The VACUUM INTO snapshot must be taken **after** all writes are complete so the new slot's DB is fully up to date when systemd brings it online.

## How

- Removed the `onStep('- Restarting service…\n')` and `setTimeout(systemctl restart)` calls from inside `blueGreenAccept`.
- Added the same logic (log step → final `copyDb` → schedule restart) in both `runAcceptAsync` and `retryAcceptAfterFix`, immediately after `db.updateEvolveSession(sessionId, { status: 'accepted' })`.
- Updated the top-of-file step list comment to reflect the new ordering.
