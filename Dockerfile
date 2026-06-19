# syntax=docker/dockerfile:1
# Lightweight multi-arch Debian image for self-hosting Primordia, including Raspberry Pi.
# Runtime installation, Bun pinning, dependency install, builds, and future accepts
# all go through Primordia's normal scripts/install.sh + mise flow.
FROM debian:bookworm-slim

ENV NODE_ENV=production \
    PRIMORDIA_DIR=/data \
    REVERSE_PROXY_PORT=3000 \
    HOSTNAME=0.0.0.0 \
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

WORKDIR /opt/primordia-seed
COPY . .

COPY scripts/docker-entrypoint.sh /usr/local/bin/primordia-docker-entrypoint
RUN chmod +x /usr/local/bin/primordia-docker-entrypoint \
  && git config --global --add safe.directory /opt/primordia-seed

VOLUME ["/data"]
EXPOSE 3000
ENTRYPOINT ["tini", "--", "primordia-docker-entrypoint"]
