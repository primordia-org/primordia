# Auto-commit uncommitted changes on accept

## What changed

When a user clicks "Accept Changes" on a session that has uncommitted files in the worktree, instead of showing a hard error ("Cannot accept: session worktree has uncommitted changes"), the system now automatically starts a follow-up agent session with the prompt "commit changes".

The agent receives a detailed prompt listing the uncommitted files and is instructed to stage and commit them with a descriptive message (without touching the changelog file). The session transitions to `running-claude` status and the progress stream resumes normally. Once the agent finishes committing, the session returns to `ready` and the user can click Accept again — this time succeeding because all changes are committed.

The client-side `handleAccept` handler now recognises the new `{ outcome: "auto-committing" }` response and updates the UI status to `running-claude`, resuming the SSE stream automatically.

## Why

Previously the error message left users stuck: they had to know to submit a manual follow-up "commit changes" request themselves. This made the flow confusing, especially since uncommitted changes are a normal consequence of the agent leaving staged-but-not-committed work (e.g. after a partial run or an abort). The new behaviour handles this transparently with no user action required beyond clicking Accept.
