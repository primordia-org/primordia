# Refactor CLI with citty

Reworked `bun run primordia` to use `citty` subcommands instead of a hand-rolled argument parser. Commands are now grouped by purpose:

- `bun run primordia status` remains top-level because it reports global process state.
- `bun run primordia thread ...` contains agentic coding flow commands: `create`, `followup`, `update`, `accept`, and `reject`.
- `bun run primordia server ...` contains current-thread server commands: `start`, `stop`, `restart`, `logs`, `publish`, and `copydb`.

Worktree-specific commands no longer accept `--worktree`; they resolve the current thread from the current working directory so the happy path is to `cd` into a thread worktree and run the command there. The CLI also omits the package.json version from generated help because the app version is not meaningful for Primordia instances.

The CLI keeps robust error behavior by validating unknown options and missing option values before command handlers run, and it preserves JSON-formatted error output for `--json` callers such as deploy/install automation.
