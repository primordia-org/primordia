# Add Primordia CLI helpers

Added `bun run primordia copydb`, a CLI command that determines the target worktree from the current directory by default and copies the current production SQLite database into that worktree using SQLite `VACUUM INTO`.

This gives operators a safe, consistent way to refresh a worktree database from production outside the evolve session flow, without manually locating the production worktree or copying WAL-backed SQLite files directly.

Added a Primordia CLI settings page at `/settings/cli` that reads this browser's `localStorage.primordia_aes_key`, validates that it looks like the expected AES JSON Web Key, and displays shell-safe `PRIMORDIA_AES_KEY=...` and `export PRIMORDIA_AES_KEY=...` snippets for copy-paste. This makes secret-backed CLI presets easier to use without asking users to manually inspect local storage or guess how to quote the JWK JSON for their shell.
