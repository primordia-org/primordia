# Self-host Primordia on a Raspberry Pi with Docker

Primordia can run as a single Docker Compose service on a Raspberry Pi or any other Linux machine supported by Docker. The image is built from the checked-out source and stores the mutable Primordia repo, SQLite database, generated worktrees, and archived sessions in a Docker volume.

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

## What persists

The Compose file creates a named volume called `primordia-data`. It contains:

- `/data/source.git` — the mutable Primordia git checkout used as production
- `/data/worktrees` — evolve preview worktrees
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

The container keeps using the persisted `/data/source.git` checkout. Primordia's own evolve/accept flow updates that checkout from inside the running app. If you intentionally edit files inside the persisted checkout and want a boot-time rebuild, set `PRIMORDIA_DOCKER_REBUILD_ON_START=1` for one restart.

## Ports and reverse proxying

By default the container publishes Primordia on host port `3000` and the internal reverse proxy starts production on `3001`. Change the left side of the Compose `ports` mapping to expose a different host port:

```yaml
ports:
  - "8080:3000"
```

Keep `REVERSE_PROXY_PORT` at `3000` inside the container unless you also change the container port.

## Notes for Raspberry Pi

- Build on a 64-bit OS. The Bun image and native packages used by Primordia are multi-arch, but 32-bit Raspberry Pi OS is not supported.
- Initial image builds can take several minutes on Pi hardware.
- Evolve sessions may be CPU and memory intensive; close unused previews from the admin health page if disk space gets tight.
- The Docker image includes a small `mise exec` compatibility shim because the container already pins Bun with the base image.
