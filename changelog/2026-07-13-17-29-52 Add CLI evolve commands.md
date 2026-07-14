# Add CLI thread commands

Implemented terminal entry points for creating and continuing threads without relying on browser session cookies.

- Added `bun run primordia create "request"` to create a thread and keep the CLI process alive while the initial setup/agent turn runs.
- Added `bun run primordia followup "request"` to run follow-up turns on the thread identified by the current working directory.
- Added `--user` and `--preset` options for both create and follow-up commands; secret-backed billing sources use the caller-provided `PRIMORDIA_AES_KEY` environment variable, and passing `-` as the request reads request text from stdin.
- Removed direct CLI `--harness`, `--model`, and `--auth-source` options so billing source, harness, and model selection comes from presets, matching the web UI.
- Consolidated shared thread behavior into `lib/threads.ts`, including `createThread` and `followupThread`, so CLI commands, admin routes, and `/api/evolve` reuse the same behavior without CLI scripts importing API route modules.
- Simplified `createThread` and `followupThread` callers so they pass only a preset ID; `lib/threads.ts` resolves billing source, harness, and model internally.
- Moved thread permission checks into `lib/threads.ts` and let CLI follow-ups pass just user/thread/request data, removing the CLI-only `localSessionForThread` reconstruction helper.
- Removed the temporary `bun run primordia evolve ...` compatibility namespace as part of moving the CLI away from evolve-specific naming.
- Added a Primordia design rule that CLI scripts must never import `app/api/**/route.ts`; shared behavior belongs in `lib/*`.
- Let the shared thread creation path run synchronously for CLI callers so worker environment variables survive until the agent finishes.
