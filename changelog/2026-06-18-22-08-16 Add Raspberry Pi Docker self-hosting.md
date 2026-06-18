# Add Raspberry Pi Docker self-hosting

Primordia can now be built and run as a single Docker Compose service for Raspberry Pi and other Linux hosts.

## What changed

- Added a multi-arch `Dockerfile` based on the pinned Bun runtime, including the system tools Primordia needs for git worktrees, previews, builds, and agent workflows.
- Added `docker-compose.yml` with a persistent `primordia-data` volume for the mutable checkout, SQLite database, evolve worktrees, and archived session logs.
- Added a Docker entrypoint that initializes the persistent runtime tree, creates `.env.local`, configures production branch/port metadata, and starts the existing reverse proxy.
- Added a `mise exec` compatibility shim in the container so existing proxy/evolve code can keep using the established command path without requiring a separate mise install.
- Added Docker-specific accept/deploy handling so production accepts inside the container run typecheck, install, build, database copy, proxy slot spawn, and mirror push without relying on systemd.
- Documented Raspberry Pi self-hosting, persistence, backups, updates, and port configuration.

## Why

Self-hosting on a Raspberry Pi should not require exe.dev or host-level systemd installation. Docker Compose gives users a familiar deployment path while preserving Primordia's self-modifying worktree architecture and blue/green proxy cutover model inside the container.
