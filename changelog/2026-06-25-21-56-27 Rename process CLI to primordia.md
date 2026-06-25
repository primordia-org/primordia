# Rename process CLI to primordia

Renamed the local process-manager entrypoint from `scripts/process.ts` to `scripts/primordia.ts` and exposed it as `bun run primordia` in `package.json`.

The process commands now follow the new shape:

- `bun run primordia status [--json]`
- `bun run primordia start [--dev|--prod] [--json] [--worktree <worktreename>]`
- `bun run primordia stop [--json] [--worktree <worktreename>]`
- `bun run primordia restart [--dev|--prod] [--json] [--worktree <worktreename>]`
- `bun run primordia logs [--follow] [--json] [--worktree <worktreename>]`

For worktree-specific commands, `--worktree` is optional and defaults to the registered Primordia worktree containing the current working directory. This makes local server management easier from inside a worktree while still allowing explicit branch/basename/path targeting when needed. Deploy/install documentation and the zero-downtime start path were updated to call the renamed CLI.
