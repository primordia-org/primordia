# Add CLI thread commands

Implemented terminal entry points for creating and continuing threads without relying on browser session cookies.

- Added `bun run primordia create "request"` to create a thread and keep the CLI process alive while the initial setup/agent turn runs.
- Added `bun run primordia followup "request"` to run follow-up turns on the thread identified by the current working directory.
- Added `--user`, `--preset`, `--harness`, `--model`, and `--auth-source` options; secret-backed billing sources use the caller-provided `PRIMORDIA_AES_KEY` environment variable.
- Consolidated shared thread behavior into `lib/threads.ts`, including `createThread` and `followupThread`, so CLI commands, admin routes, and `/api/evolve` reuse the same behavior without CLI scripts importing API route modules.
- Removed the temporary `bun run primordia evolve ...` compatibility namespace as part of moving the CLI away from evolve-specific naming.
- Added a Primordia design rule that CLI scripts must never import `app/api/**/route.ts`; shared behavior belongs in `lib/*`.
- Let the shared thread creation path run synchronously for CLI callers so worker environment variables survive until the agent finishes.
