# Add process status CLI

Implemented a small process manager library and `bun run process status` CLI for inspecting Primordia worktrees without asking the reverse proxy for process state.

The new status command lists each registered git worktree, its assigned branch port, any active Next.js listener on that port, the inferred server mode, server PID(s), and active agent worker PID(s). It supports the default human-readable table, `--json` output, and `--watch` refresh mode.
