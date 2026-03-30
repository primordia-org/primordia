# Log branch accept and reject decisions to session

## What changed

### `lib/local-evolve-sessions.ts`
- Added `'accepted'` and `'rejected'` to the `LocalSessionStatus` union type.
- When creating the worktree, the session ID is now stored in git config as `branch.<name>.sessionId` alongside the existing `branch.<name>.parent` entry. This lets the preview instance locate the parent's session record when the user accepts or rejects.

### `app/api/evolve/local/manage/route.ts`
- `getPreviewInfo` now also reads `branch.<name>.sessionId` from git config and includes `sessionId` in its return value.
- New helper `logDecisionToParentDb`: opens the parent instance's SQLite database (`.primordia-auth.db` at the parent repo root), appends a markdown log entry ("✅ Accepted — merged into `<branch>`" or "🗑️ Rejected — branch discarded"), and updates the session's `status` column to `"accepted"` or `"rejected"`. Errors are swallowed so they never block the accept/reject response.
- `logDecisionToParentDb` is called after a successful merge (accept) and after the reject decision, before the git worktree/branch cleanup.

### `components/EvolveSessionView.tsx`
- Added `"accepted"` and `"rejected"` to the `EvolveSessionData` status union type and all terminal-status check arrays (`isTerminal`, polling stop condition, initial poll skip).
- The **preview link** and **submit a follow-up** form are now hidden once status is `"accepted"` or `"rejected"` — these UI sections were only useful while the preview was still live.
- Added two new informational banners:
  - Green "✅ Changes accepted" banner shown when `status === "accepted"`.
  - Red "🗑️ Changes rejected" banner shown when `status === "rejected"`.

## Why

Previously, accepting or rejecting a branch silently removed the worktree and exited the preview server. The session page in the parent app had no way to know a decision had been made — it showed a stale "Preview ready" state with a dead preview link and an active follow-up form, which was confusing. Now the parent's session record is updated atomically with the decision, so the session page immediately reflects the outcome when the user returns to it.
