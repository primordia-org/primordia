# Sandbox local evolve Claude instance to its worktree

## What changed

Added a `PreToolUse` hook to the `query()` call in `lib/local-evolve-sessions.ts` that
enforces a hard filesystem boundary around the worktree created for each local evolve
session.

The hook (`makeWorktreeBoundaryHook`) blocks any tool call whose target path resolves
outside `session.worktreePath`:

- **Read / Write / Edit** — `file_path` is resolved and checked.
- **Glob / Grep** — `path` is checked when it is an absolute path.
- **Bash** — commands that contain an explicit reference to the main repo root path
  (`repoRoot`) are blocked, preventing `git -C /main/repo …` style escapes.

Blocked calls return `decision: 'block'` with an explanatory reason string that appears
in the progress log.

## Why

A Claude Code session running inside a worktree could still use absolute paths to read or
write files in the main branch checkout. In at least one observed case it committed
directly to the main branch instead of the isolated preview branch. This change makes
that impossible by intercepting every relevant tool call before it executes.
