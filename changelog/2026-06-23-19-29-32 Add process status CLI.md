# Add process status CLI

Implemented a small process manager library and `bun run process status` CLI for inspecting Primordia worktrees without asking the reverse proxy for process state.

The new status command lists each registered non-bare git worktree, its assigned branch port, any active Next.js listener on that port, the inferred server mode, server PID(s), and active agent worker PID(s). It skips the bare source repository entry from `git worktree list --porcelain`. The default table keeps the columns compact (`Worktree`, `Port`, `Running`, `Env`, `PID`, `Agents`) while `--json` retains full details including worktree paths; `--watch` refreshes the view continuously.
