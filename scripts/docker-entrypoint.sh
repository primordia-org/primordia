#!/usr/bin/env bash
set -euo pipefail

export PRIMORDIA_DIR="${PRIMORDIA_DIR:-/data}"
export REVERSE_PROXY_PORT="${REVERSE_PROXY_PORT:-3000}"
export HOME="${HOME:-/root}"

SEED_DIR="/opt/primordia-seed"
MISE_BIN="${HOME}/.local/bin/mise"
BRANCH="${PRIMORDIA_DOCKER_BRANCH:-main}"

REPORT_STYLE=plain \
PRIMORDIA_INSTALL_FORCE_STANDALONE=1 \
PRIMORDIA_SEED_DIR="$SEED_DIR" \
bash "$SEED_DIR/scripts/install.sh" "$BRANCH"

exec "$MISE_BIN" exec -C "$PRIMORDIA_DIR" -- bun "$PRIMORDIA_DIR/reverse-proxy.ts"
