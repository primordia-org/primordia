# Add Raspberry Pi Docker self-hosting

Primordia can now be started as a single Docker Compose service for Raspberry Pi and other Linux hosts, while still using the same installer and runtime-management path as non-Docker installs.

## What changed

- Added a lightweight multi-arch Debian `Dockerfile` that seeds the Primordia source but does not bake in Bun dependencies or a production build.
- Added `docker-compose.yml` with a persistent `primordia-data` volume for the mutable git repository, production/evolve worktrees, SQLite database, and archived session logs.
- Added a Docker entrypoint that initializes `/data/source.git`, creates the boot worktree, writes `.env.local`, runs `scripts/install.sh`, then starts the existing reverse proxy through `mise exec`.
- Kept runtime ownership with `mise` and the normal installer instead of adding a Docker-specific Bun runtime shim or custom deploy path.
- Updated `scripts/install.sh` to respect an existing `REVERSE_PROXY_PORT` environment variable before falling back to its host-type defaults.
- Documented Raspberry Pi self-hosting, persistence, backups, updates, and port configuration.

## Why

Self-hosting on a Raspberry Pi should be easy without turning Docker into Primordia's update manager. The container now acts as a lightweight host wrapper: it provides Debian system packages and persistent storage, then lets Primordia install runtimes with mise, install/update dependencies, rebuild itself, accept evolve changes, and fix security issues through the same paths used outside Docker.
