# Add process status CLI

Implemented a small process manager library and `bun run process status` CLI for inspecting Primordia worktrees without asking the reverse proxy for process state.

The new status command lists each registered non-bare git worktree, its assigned branch port, any active Next.js listener on that port, the server process state, inferred environment, server PID(s), and active agent worker PID(s). It skips the bare source repository entry from `git worktree list --porcelain`. The default table keeps the columns compact (`Worktree`, `Port`, `State`, `Env`, `PID`, `Agents`) while `--json` retains full details including worktree paths and a `servers` array, where an empty array means no active listener and multiple entries indicate an abnormal multi-listener situation. Continuous refresh is intentionally left to standard tools like Linux `watch`.
