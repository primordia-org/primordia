# Refactor Primordia CLI organization and help

Reworked `bun run primordia` around a small internal CLI definition helper instead of a hand-rolled parser or third-party generated help. Commands declare their subcommands, arguments, options, and optional completion hooks in one structure, which is used for parsing, a single detailed help message, and bash completion generation.

Commands are grouped by purpose:

- `bun run primordia status` remains top-level because it reports global process state.
- `bun run primordia thread ...` contains agentic coding flow commands: `create`, `followup`, `update`, `accept`, and `reject`.
- `bun run primordia server ...` contains current-thread server commands: `start`, `stop`, `restart`, `logs`, `publish`, and `copydb`.

Worktree-specific commands no longer accept `--worktree`; they resolve the current thread from the current working directory so the happy path is to `cd` into a thread worktree and run the command there. The CLI also omits the package.json version from help because the app version is not meaningful for Primordia instances.

The CLI keeps robust error behavior by validating unknown options and missing option values before command handlers run, preserves JSON-formatted error output for `--json` callers such as deploy/install automation, and can print a bash completion script with `bun run primordia completion bash`. Completion supports static subcommands/options plus dynamic completion hooks for individual options, arguments, and commands.
