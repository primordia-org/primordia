# Add CLI evolve commands

Implemented terminal entry points for starting and continuing evolve work without relying on browser session cookies.

- Added `bun run primordia new "request"` to create an evolve thread and keep the CLI process alive while the initial setup/agent turn runs.
- Added `bun run primordia agent [--thread <id>]` and `bun run primordia reply [--thread <id>] "request"` for running agent turns on existing threads.
- Added compatibility aliases under `bun run primordia evolve create|run|followup`.
- Added `--user`, `--preset`, `--harness`, `--model`, `--auth-source`, and `--thread` options; secret-backed billing sources use the caller-provided `PRIMORDIA_AES_KEY` environment variable.
- Let the shared evolve-session creation path run synchronously for CLI callers so worker environment variables survive until the agent finishes.
