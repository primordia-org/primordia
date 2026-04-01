# Provide CWD to Claude Code system prompt

## What changed

All three `query()` calls in `lib/local-evolve-sessions.ts` now pass a `systemPrompt` option that uses the Claude Code preset and appends the current working directory:

```typescript
systemPrompt: {
  type: 'preset',
  preset: 'claude_code',
  append: `The current working directory is: ${cwd}`,
},
```

The three call sites are:
1. **Main evolve run** (`startLocalEvolve`) — appends the worktree path.
2. **Follow-up run** (`runFollowupInWorktree`) — appends the worktree path.
3. **Merge conflict resolver** (`resolveConflictsWithClaude`) — appends the merge root path.

## Why

Claude Code sometimes gets confused about where it's running, especially inside git worktrees where the directory structure differs from a normal checkout. Explicitly stating the CWD in the system prompt gives Claude Code an unambiguous anchor point, reducing the risk of it operating on the wrong directory or making incorrect assumptions about file paths.
