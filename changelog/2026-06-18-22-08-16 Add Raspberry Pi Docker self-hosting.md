# Add Raspberry Pi Docker self-hosting

Primordia can now be started as a single Docker Compose service for Raspberry Pi and other Linux hosts, while still using the same installer and runtime-management path as non-Docker installs.

## What changed

- Added a lightweight multi-arch Debian `Dockerfile` that provides host packages only; it does not bake in Primordia source, Bun dependencies, or a production build.
- Added `docker-compose.yml` with a persistent `primordia-data` volume for the mutable git repository, production/evolve worktrees, SQLite database, and archived session logs.
- Added a minimal Docker entrypoint that downloads `/install.sh` from `PRIMORDIA_PARENT_URL` on first boot, runs it with `PRIMORDIA_DOCKER_BRANCH`, and then starts the existing reverse proxy through `mise exec`.
- Added `PRIMORDIA_INSTALL_URL` as an escape hatch for fully custom installer paths; it takes precedence over `PRIMORDIA_PARENT_URL`.
- Kept runtime ownership with `mise` and the normal installer instead of adding a Docker-specific Bun runtime shim, source seed, or custom deploy path.
- Updated `scripts/install.sh` to respect an existing `PRIMORDIA_DIR` and `REVERSE_PROXY_PORT` environment variable before falling back to defaults.
- Documented Raspberry Pi self-hosting, persistence, backups, updates, parent instance overrides, and branch configuration.

## Why

Self-hosting on a Raspberry Pi should be easy without turning Docker into Primordia's update manager or tying the image to a specific Primordia source snapshot. The container now acts as a lightweight host wrapper: it provides Debian system packages and persistent storage, then lets Primordia install runtimes with mise, clone from the chosen parent instance, install/update dependencies, rebuild itself, accept evolve changes, and fix security issues through the same paths used outside Docker.
