# Fix Claude Code binary not found in worktree

## What changed

Added `pathToClaudeCodeExecutable: '/usr/local/bin/claude'` to the `query()` options in `scripts/claude-worker.ts`.

## Why

When Claude Agent SDK runs inside a git worktree, it looks for the Claude Code native binary relative to the worktree's own `node_modules`. Because worktrees share `node_modules` via symlink (or `bun install` skips native binaries in them), the binary was not found at the expected path:

```
/home/exedev/primordia-worktrees/<branch>/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude
```

This caused every evolve session to immediately fail with:

> Claude Code native binary not found at ... Please ensure Claude Code is installed via native installer or specify a valid path with options.pathToClaudeCodeExecutable.

The fix explicitly tells the SDK to use the system-installed Claude binary at `/usr/local/bin/claude`, which is always present on the host.

## When introduced

The bug was introduced on **2026-04-10** in commit `6150427` — *"feat: persistent Claude Code workers with PID-based concurrency guard"*. That commit extracted all Claude Code execution into `scripts/claude-worker.ts` (a detached subprocess that survives server restarts), but omitted `pathToClaudeCodeExecutable` from the `query()` options. Prior to that commit, `query()` was called in-process from the main server where `node_modules` was resolved correctly against the main repo root, so the binary was always found. The move to a worker subprocess running with a worktree `cwd` exposed the missing option.
