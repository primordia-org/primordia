# Add installer bash helpers

The installer now maintains idempotent marked shell helper blocks in `~/.bashrc` so rerunning install or update keeps the helpers current without duplicating them.

It installs the `PRIMORDIA_DIR` export and `primordia` alias as a separate "Installed primordia bash alias" step. On exe.dev hosts, it also installs the `cdprod` helper as a separate "Installed cdprod bash function" step that jumps to the currently configured production branch under `PRIMORDIA_DIR/worktrees/` using the installation's bare repository config.

`bun run primordia status` now reports the service-supervisor, reverse proxy service, and scheduled jobs service alongside worktree app servers so operators can see all supervised runtime processes in one place.
