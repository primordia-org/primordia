# Track dev server lifecycle after accept or reject

## What changed

Added lifecycle tracking for spawned preview dev servers so the parent server's in-memory session map stays accurate after a session ends.

### `lib/local-evolve-sessions.ts`

- Added `'disconnected'` to the `LocalSessionStatus` union type.
- Extended the `close` event handler on the spawned dev server process to handle the case where the process dies **after** the server was already `ready` (previously, the handler only acted when the server died during startup).

When the process closes in the `ready` state the new logic:

1. Waits **3 seconds** (a `setTimeout`) to allow any in-flight git cleanup — `worktree remove`, `branch -d/-D` — that the preview instance's `manage/route.ts` starts just before calling `process.exit(0)` to finish.
2. Runs `git branch --list <branch>` against `repoRoot` to check whether the branch still exists.
   - **Branch is gone** → the session was accepted or rejected cleanly; the session entry is deleted from the `sessions` map.
   - **Branch still exists** → the server was killed manually, crashed, or was restarted externally; the session's `status` is set to `'disconnected'` and `devServerProcess` is nulled out.
3. If the `git` command itself fails for any reason, the session is conservatively marked `'disconnected'`.

## Why

Previously, when a user clicked **Accept** or **Reject** in the preview instance, the preview server called `process.exit(0)`. The spawned `ChildProcess` in the parent server's memory went dead, but the parent's `sessions` map continued to show the session as `'ready'`. This meant:

- The UI could keep polling a session that was already gone, showing a stale "ready" state.
- There was no way for the UI to distinguish a cleanly completed session from one whose server had merely crashed.

The new `disconnected` status gives the UI a clear signal that the server is unreachable but the branch still exists (so the user may want to investigate or restart it manually), while silently cleaning up sessions that finished normally via the accept/reject flow.
