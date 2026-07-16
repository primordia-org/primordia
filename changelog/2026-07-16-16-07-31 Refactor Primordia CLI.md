# Refactor Primordia CLI organization and help

Reworked `bun run primordia` around a small internal CLI definition helper instead of a hand-rolled parser or third-party generated help. Commands declare their subcommands, arguments, options, and optional completion hooks in one structure, which is used for parsing, a single detailed help message, and bash completion generation.

Commands are grouped by purpose:

- `bun run primordia status` remains top-level because it reports global process state.
- `bun run primordia thread ...` contains agentic coding flow commands: `create`, `followup`, `update`, `accept`, and `reject`.
- `bun run primordia server ...` contains current-thread server commands: `start`, `stop`, `restart`, `logs`, `publish`, and `copydb`.

Worktree-specific commands no longer accept `--worktree`; they resolve the current thread from the current working directory so the happy path is to `cd` into a thread worktree and run the command there. The CLI also omits the package.json version from help because the app version is not meaningful for Primordia instances.

The CLI keeps robust error behavior by validating unknown options and missing option values before command handlers run, preserves JSON-formatted error output for `--json` callers such as deploy/install automation, and can print a bash completion script with `bun run primordia completion bash`. The help text shows how to enable completion with `source <(bun run --silent primordia completion bash)`, and the generated completion function calls `bun run --silent primordia __complete` so shell completion does not include Bun's command echo. Completion supports static subcommands/options plus dynamic completion hooks for individual options, arguments, and commands.

Follow-up profiling found that completion was still too slow because `scripts/primordia.ts` statically imported `lib/threads.ts`, which pulled the pi coding agent and AI provider stack into even the `__complete` path. The CLI now lazy-loads runtime handlers from `scripts/primordia-command-handlers.ts` only when real commands run, leaving help and completion on a tiny metadata path. Measured `__complete sta` dropped from roughly 0.56s to about 0.01–0.02s locally, and the Bun bundle for the completion path shrank from about 10.7 MB / 2630 modules to about 16–17 KB. Preset completion now presents short built-in IDs without the `builtin:` prefix (for example, `claude-code-gateway`) and includes per-user custom presets as slugified display names when `--user` selects a user or when there is only one user. The CLI maps both short built-in IDs and custom preset slugs back to their stored preset IDs internally, avoiding colon-related bash completion edge cases and reducing typing. `docs/primordia-cli-completion-performance-proposal.md` records the profiling details and implementation notes.
