#!/usr/bin/env bash
set -euo pipefail

export PRIMORDIA_DIR="${PRIMORDIA_DIR:-/data}"
export REVERSE_PROXY_PORT="${REVERSE_PROXY_PORT:-3000}"
export HOME="${HOME:-/root}"

MISE_BIN="${HOME}/.local/bin/mise"
BRANCH="${PRIMORDIA_DOCKER_BRANCH:-main}"
PARENT_URL="${PRIMORDIA_PARENT_URL:-https://primordia.exe.xyz}"
INSTALL_URL="${PRIMORDIA_INSTALL_URL:-${PARENT_URL%/}/install.sh}"

if [[ ! -f "${PRIMORDIA_DIR}/reverse-proxy.ts" ]]; then
  curl -fsSL "$INSTALL_URL" | REPORT_STYLE=plain bash -s -- "$BRANCH"
fi

exec "$MISE_BIN" exec -C "$PRIMORDIA_DIR" -- bun "$PRIMORDIA_DIR/reverse-proxy.ts"
