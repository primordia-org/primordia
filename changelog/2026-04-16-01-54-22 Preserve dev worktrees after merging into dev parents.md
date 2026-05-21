# Preserve dev worktrees after merging into dev parents

When a session is accepted and merged into a **dev** (non-production) parent
branch, the worktree is no longer deleted afterward. This means:

- The session logs (NDJSON file) remain readable after the merge.
- The preview dev server is not killed up front — it keeps running, so the
  result can still be inspected at the preview URL.

The worktree, branch, and git config for the session are left in place and
can be cleaned up manually later.

**What changed in `app/api/evolve/manage/route.ts`:**

1. `isProduction` is now computed *before* the preview-server kill so it can
   be used to decide whether to kill it.
2. The preview-server kill is now skipped for dev accepts (`body.action ===
   'accept' && !isProduction`); it still fires for rejects and production
   accepts.
3. The three cleanup lines (`git worktree remove`, `git branch -D`,
   `git config --remove-section`) that ran at the end of the faster dev pipeline merge
   path have been removed.
