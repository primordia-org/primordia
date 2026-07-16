# Refactor CLI with citty

Reworked `bun run primordia` to use `citty` subcommands instead of a hand-rolled argument parser. Each command now declares its own options and generated help text, while shared helpers preserve the existing process-management and thread lifecycle behavior.

The CLI also keeps robust error behavior by validating unknown options and missing option values before command handlers run, and it preserves JSON-formatted error output for `--json` callers such as deploy/install automation.
