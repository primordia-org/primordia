# Add primordia copydb command

Added `bun run primordia copydb`, a CLI command that determines the target worktree from the current directory by default and copies the current production SQLite database into that worktree using SQLite `VACUUM INTO`.

This gives operators a safe, consistent way to refresh a worktree database from production outside the evolve session flow, without manually locating the production worktree or copying WAL-backed SQLite files directly.
