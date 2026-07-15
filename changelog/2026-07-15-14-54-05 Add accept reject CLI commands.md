# Add accept/reject CLI commands

Added `bun run primordia accept` and `bun run primordia reject` commands so terminal-created or cwd-selected threads can be accepted or rejected without using the web UI.

The accept/reject implementation now lives in shared thread management code under `lib/threads.ts`, keeping the API route and CLI on the same behavior path while preserving the rule that CLI scripts do not import API route modules directly.
