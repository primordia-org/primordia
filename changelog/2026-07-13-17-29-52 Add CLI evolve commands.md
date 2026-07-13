# Add CLI evolve commands

Implemented terminal entry points for creating and continuing evolve threads without relying on browser session cookies.

- Added `bun run primordia create "request"` to create an evolve thread and keep the CLI process alive while the initial setup/agent turn runs.
- Added `bun run primordia followup "request"` to run follow-up turns on the evolve thread identified by the current working directory.
- Added compatibility aliases under `bun run primordia evolve create|followup`.
- Added `--user`, `--preset`, `--harness`, `--model`, and `--auth-source` options; secret-backed billing sources use the caller-provided `PRIMORDIA_AES_KEY` environment variable.
- Let the shared evolve-session creation path run synchronously for CLI callers so worker environment variables survive until the agent finishes.
