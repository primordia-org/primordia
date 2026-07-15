# Add accept/reject/update CLI commands

Added `bun run primordia accept` and `bun run primordia reject` commands so terminal-created or cwd-selected threads can be accepted or rejected without using the web UI.

Added `bun run primordia update` as the CLI equivalent of the session page's Apply Updates action. It merges the parent/prod branch into the selected thread, runs `bun install`, and hot-swaps a production DB snapshot into the preview when available.

The accept/reject/update implementations now live in shared thread management code under `lib/threads.ts`, keeping the API routes and CLI on the same behavior path while preserving the rule that CLI scripts do not import API route modules directly.
