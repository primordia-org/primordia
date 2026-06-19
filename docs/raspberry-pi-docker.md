# Self-host Primordia on a Raspberry Pi with Docker

Primordia can run as a single Docker Compose service on a Raspberry Pi or any other Linux machine supported by Docker. The image is intentionally lightweight: on first boot its entrypoint downloads `/install.sh` from the configured parent instance, runs Primordia's normal installer inside the persistent volume, then starts the same reverse proxy command a systemd service would run. Runtime management still goes through `mise`, and Primordia keeps its usual autonomy to install dependencies, rebuild itself, accept evolve sessions, and apply security fixes from inside the container.

## Requirements

- Raspberry Pi 4/5 or another arm64 Linux host recommended
- 64-bit Raspberry Pi OS or another 64-bit Linux distribution
- Docker Engine with the Compose plugin
- At least 4 GB RAM recommended for local builds and evolve sessions
- Enough disk space for the app, `node_modules`, `.next`, and future worktrees

## Quick start

```bash
git clone <your-primordia-repo-url> primordia
cd primordia
docker compose up -d --build
```

Open `http://<raspberry-pi-hostname-or-ip>:3000`.

The first user to register becomes the admin. You can add AI credentials from **Settings** after signing in, or use any gateway/API-key setup already supported by Primordia.

## Installer source and branch

By default, first boot downloads `https://primordia.exe.xyz/install.sh` and installs the `main` branch. Override these with Docker environment variables:

```yaml
environment:
  PRIMORDIA_PARENT_URL: https://your-parent.example.com
  PRIMORDIA_DOCKER_BRANCH: main
```

If you need a fully custom installer URL, set `PRIMORDIA_INSTALL_URL`; it takes precedence over `PRIMORDIA_PARENT_URL`.

## What persists

The Compose file creates a named volume called `primordia-data`. It contains:

- `/data/source.git` — the mutable Primordia git repository
- `/data/worktrees` — the production worktree and evolve preview worktrees
- `/data/past-sessions` — archived session logs
- SQLite auth/evolve/settings data inside the persisted checkout

To back up a Pi-hosted instance:

```bash
docker run --rm -v primordia-data:/data -v "$PWD":/backup debian:stable-slim \
  tar czf /backup/primordia-data-backup.tgz -C /data .
```

## Updating the container image

Pull or merge code changes in your host checkout, then rebuild:

```bash
docker compose up -d --build
```

The container keeps using the persisted `/data/source.git` repository and production worktree under `/data/worktrees/`. Primordia's own evolve/accept flow updates that checkout from inside the running app using the same installer path as other self-hosted installs. Rebuilding the Docker image is only needed when the lightweight host wrapper itself changes; day-to-day dependency updates, rebuilds, accepted changes, and security fixes happen in the persisted Primordia install.

## Ports and reverse proxying

By default the container publishes Primordia on host port `3000` and the internal reverse proxy starts production on `3001`. Change the left side of the Compose `ports` mapping to expose a different host port:

```yaml
ports:
  - "8080:3000"
```

Keep `REVERSE_PROXY_PORT` at `3000` inside the container unless you also change the container port.

## Notes for Raspberry Pi

- Build on a 64-bit OS. The Debian base image, mise-managed Bun runtime, and native packages used by Primordia are multi-arch, but 32-bit Raspberry Pi OS is not supported.
- First boot can take several minutes on Pi hardware because the normal installer downloads mise/Bun, installs dependencies, and builds the app in the persistent volume.
- Evolve sessions may be CPU and memory intensive; close unused previews from the admin health page if disk space gets tight.
- The Docker image does not include a custom Bun runtime or deploy path. It relies on mise and `scripts/install.sh`, just like non-Docker Primordia installs.
