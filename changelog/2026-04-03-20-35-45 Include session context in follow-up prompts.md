# Include session context in follow-up prompts

## What changed

`lib/evolve-sessions.ts` — `runFollowupInWorktree` now injects a **session context block** into every user-facing follow-up prompt (type-fix passes are unaffected). The block contains:

1. **Original request** — the text the user submitted when the session was created.
2. **Previous follow-up requests** — all prior follow-up texts extracted from `progressText`, listed in submission order. (Omitted when this is the first follow-up.)
3. **Commits made so far** — `git log --oneline {parentBranch}..HEAD`, scoped to commits added in this session via the stored `branch.{name}.parent` git config entry. Falls back to `git log --oneline -10` if the parent branch isn't recorded.

A new private helper `extractPriorFollowupRequests(progressText)` parses the follow-up sections out of `progressText` using the literal format that the progress logger writes (`### 🔄 Follow-up Request\n\n> {text}\n\n### 🤖 Claude Code`).

## Why

In a real session, a user sent the follow-up message "retry". Because the follow-up prompt contained only the literal word "retry" with no surrounding context, Claude Code inside the worktree had no idea what to retry.

Claude Code was clever enough to hack its way into the SQLite database and then search `.claude/projects/` to reconstruct the original request — but that behaviour bypassed the worktree boundary sandbox and could have accidentally touched production state or other worktrees.

The correct fix is to give Claude the information it needs directly in the prompt, eliminating any need to go looking for it elsewhere.
