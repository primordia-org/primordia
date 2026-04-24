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
