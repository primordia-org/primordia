# syntax=docker/dockerfile:1
# Lightweight multi-arch Debian image for self-hosting Primordia, including Raspberry Pi.
# The container installs Primordia on first boot by downloading /install.sh from
# the configured parent instance, then runs the normal mise-managed proxy.
FROM debian:bookworm-slim

ENV NODE_ENV=production \
    PRIMORDIA_DIR=/data \
    REVERSE_PROXY_PORT=3000 \
    PRIMORDIA_PARENT_URL=https://primordia.exe.xyz \
    PRIMORDIA_DOCKER_BRANCH=main \
    DEBIAN_FRONTEND=noninteractive

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
    sqlite3 \
    tini \
    unzip \
    util-linux \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

COPY scripts/docker-entrypoint.sh /usr/local/bin/primordia-docker-entrypoint
RUN chmod +x /usr/local/bin/primordia-docker-entrypoint

VOLUME ["/data"]
EXPOSE 3000
ENTRYPOINT ["tini", "--", "primordia-docker-entrypoint"]
