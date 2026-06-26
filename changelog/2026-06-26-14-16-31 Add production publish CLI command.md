# Add production publish CLI command

Added `bun run primordia publish [--worktree <worktreename>]` to the official Primordia process-management CLI.

The new command resolves the target worktree the same way as the existing `start`, `stop`, `restart`, and `logs` commands, performs an HTTP health check against that branch's assigned local port, and only then updates `primordia.productionBranch` in git config. It also supports `--json` output for automation and records the branch in production history when it actually changes production.
