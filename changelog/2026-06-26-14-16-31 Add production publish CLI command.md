# Add production publish CLI command

Added `bun run primordia publish [--worktree <worktreename>]` to the official Primordia process-management CLI.

The new command resolves the target worktree the same way as the existing `start`, `stop`, `restart`, and `logs` commands, performs an HTTP health check against that branch's assigned local port, and only then updates `primordia.productionBranch` in git config. It also supports `--json` output for automation and records the branch in production history when it actually changes production.

Updated `scripts/install.sh` to use this official publish command during both zero-downtime slot swaps and restart/start deployments, replacing the previous hand-written git config writes with the shared health-checked abstraction.

Confirmed `bun run primordia start --prod` already assigns and persists a branch port through the shared process-manager path when one does not exist. Also updated `bun run primordia status` so both table and JSON output include the current production branch from git config, making it visible without calling `git config` directly.
