# Add installer bash helpers

The installer now maintains a marked Primordia shell helper block in `~/.bashrc` so rerunning install or update is idempotent. The block exports the installed `PRIMORDIA_DIR` and adds the requested `primordia` alias.

On exe.dev hosts, the same block also includes a `cdprod` helper that jumps to the currently configured production branch using the installation's bare repository config.
