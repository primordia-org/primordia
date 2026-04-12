# Eliminate `evolve_sessions` SQLite table in favor of git and filesystem

## What changed

The `evolve_sessions` SQLite table has been removed entirely. Session state is now derived entirely from git and the NDJSON event log — no supplementary filesystem state files are needed.

### Single source of truth: `.primordia-session.ndjson`

The NDJSON event log was already the authoritative record of what happened in a session. It now also serves as:

| Previously stored in | Now derived from |
|---------------------|-----------------|
| `.primordia-status` | `inferStatusFromEvents()` — scans event types in the NDJSON log |
| `.primordia-preview-url` | Always `/preview/<sessionId>` when status is `ready` |
| `.primordia-branch` | `git worktree list --porcelain` / `git symbolic-ref HEAD` in the worktree |
| `.primordia-session.ndjson` | Unchanged — always was the authoritative record |

Port is still read from git config `branch.<name>.port`.
Request text, timestamps, and metrics are still read from the NDJSON log.

### Status inference rules (`inferStatusFromEvents`)

| Condition | Inferred status |
|-----------|----------------|
| `decision` event present | `accepted` or `rejected` |
| `result` event present with no `section_start` after it | `ready` |
| Last `section_start` is `deploy` | `accepting` |
| Last `section_start` is `type_fix` | `fixing-types` |
| Last `section_start` is `claude` or `followup` | `running-claude` |
| Otherwise (setup section or no events yet) | `starting` |

### Code changes

- **`lib/session-events.ts`**: Removed `readSessionStatus`, `writeSessionStatus`, `readSessionPreviewUrl`, `writeSessionPreviewUrl`, `readSessionBranch`, `writeSessionBranch`. Added `inferStatusFromEvents()`. `buildSessionFromWorktreePath` now checks for `.primordia-session.ndjson` as the session existence marker and derives branch from git. `listSessionsFromFilesystem` extracts branch from porcelain output.
- **`scripts/claude-worker.ts`**: Removed `writeSessionStatus` and `writeSessionPreviewUrl` calls. Removed `setReadyOnSuccess` and `publicOrigin` from `WorkerConfig` — the worker just writes events; the server infers state from them.
- **`lib/evolve-sessions.ts`**: Removed `persist()` helpers. `startLocalEvolve` now accepts `initialEventAlreadyWritten` option so the route handler can write the initial event synchronously before fire-and-forget (avoiding a race window). `runFollowupInWorktree` detects worker success by checking the last result event's subtype instead of reading a status file. `reconnectRunningWorkers` no longer calls `writeSessionStatus` — the recovery event it appends already makes the inferred status `ready`.
- **`app/api/evolve/route.ts`** and **`from-branch/route.ts`**: Write `initial_request` event synchronously before firing off `startLocalEvolve`, so the session is immediately discoverable.
- **`app/api/evolve/followup/route.ts`**: Removed `writeSessionStatus('running-claude')` — status is inferred from the `section_start:claude` event written by `runFollowupInWorktree`.
- **`app/api/evolve/abort/route.ts`**: Replaced `writeSessionStatus('ready')` with appending a `result:aborted` event.
- **`app/api/evolve/manage/route.ts`**: Removed all `writeSessionStatus` calls. `failWithError` now appends a `result:error` event. `logDecision` now only writes the `decision` event (no status file). `retryAcceptAfterFix` guard simplified to `!current` check only (success/failure is detected by `runFollowupInWorktree` before calling the callback).

### Race-condition fix

The POST handler now writes the `initial_request` event synchronously before returning, so the session is immediately discoverable via `getSessionFromFilesystem()` with no race window.

## Why

The three supplementary state files (`.primordia-status`, `.primordia-preview-url`, `.primordia-branch`) were redundant:

- **Status** can be reliably inferred from the sequence of events already written to the NDJSON log by the worker and route handlers.
- **Preview URL** is structurally always `/preview/<sessionId>` — storing it was cargo-culting the old full-URL approach from when origins could vary.
- **Branch** is already tracked by git's worktree machinery; reading it from `git worktree list` or `git symbolic-ref HEAD` is more authoritative than a separate file.

Eliminating these files means:
- Simpler reasoning: the NDJSON log is the only session state artifact
- No dual-write inconsistency risk between the status file and the event log
- No stale status files left behind if the worker crashes before writing them
