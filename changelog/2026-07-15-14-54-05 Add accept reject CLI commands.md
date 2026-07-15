# Add accept/reject/update CLI commands

Added `bun run primordia accept` and `bun run primordia reject` commands so terminal-created or cwd-selected threads can be accepted or rejected without using the web UI.

Added `bun run primordia update` as the CLI equivalent of the session page's Apply Updates action. It merges the parent/prod branch into the selected thread, runs `bun install`, and updates the thread's SQLite DB snapshot. When the preview server is running, it hot-swaps through the preview endpoint; when the preview server is stopped, it performs a quiet direct copy instead of warning about an unreachable hotswap endpoint. If the preview server appears to be running but the endpoint is unreachable, the error now suggests restarting the preview server and retrying.

The accept/reject/update implementations now live in shared thread management code under `lib/threads.ts`, keeping the API routes and CLI on the same behavior path while preserving the rule that CLI scripts do not import API route modules directly.
