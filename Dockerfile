# syntax=docker/dockerfile:1
# Multi-arch image for self-hosting Primordia, including Raspberry Pi arm64.
FROM oven/bun:1.3.13-debian AS app

ENV NODE_ENV=production \
    PRIMORDIA_DOCKER=1 \
    PRIMORDIA_DIR=/data \
    REVERSE_PROXY_PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /opt/primordia

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    coreutils \
    curl \
    git \
    openssh-client \
    procps \
    python3 \
    rsync \
    tini \
    util-linux \
  && rm -rf /var/lib/apt/lists/*

# Primordia's proxy and evolve workers run commands through `mise exec -C ... --`.
# The container already pins Bun via this base image, so this lightweight shim
# preserves that interface without installing a second runtime manager.
RUN printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ "${1:-}" == "exec" ]]; then' \
  '  shift' \
  '  cwd=""' \
  '  if [[ "${1:-}" == "-C" ]]; then cwd="$2"; shift 2; fi' \
  '  if [[ "${1:-}" == "--" ]]; then shift; fi' \
  '  if [[ -n "$cwd" ]]; then cd "$cwd"; fi' \
  '  exec "$@"' \
  'fi' \
  'echo "Docker image includes a mise exec compatibility shim only." >&2' \
  'exit 2' \
  > /usr/local/bin/mise \
  && chmod +x /usr/local/bin/mise

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .
RUN git config --global --add safe.directory /opt/primordia \
  && bun run build

COPY scripts/docker-entrypoint.sh /usr/local/bin/primordia-docker-entrypoint
RUN chmod +x /usr/local/bin/primordia-docker-entrypoint

VOLUME ["/data"]
EXPOSE 3000
ENTRYPOINT ["tini", "--", "primordia-docker-entrypoint"]
