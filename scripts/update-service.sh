#!/usr/bin/env bash
# scripts/update-service.sh
# Updates an already-installed Primordia reverse-proxy service.
# Run automatically as part of every blue-green production deploy so that
# changes to reverse-proxy.ts or primordia-proxy.service take effect without
# requiring a manual re-install.
#
# - Runs daemon-reload only if the service unit file changed.
# - Runs systemctl restart primordia-proxy only if the proxy script changed.
# - Exits silently (exit 0) when neither file changed.
#
# Usage:
#   bash scripts/update-service.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_SERVICE_SRC="${SCRIPT_DIR}/primordia-proxy.service"
PROXY_SERVICE_DST="/etc/systemd/system/primordia-proxy.service"
PROXY_STABLE="$HOME/primordia-proxy.ts"

SERVICE_CHANGED=false
PROXY_CHANGED=false

# Check if the service unit file changed compared to the currently installed copy.
if [[ ! -e "${PROXY_SERVICE_DST}" ]]; then
  SERVICE_CHANGED=true
elif ! diff -q "${PROXY_SERVICE_SRC}" "${PROXY_SERVICE_DST}" >/dev/null 2>&1; then
  SERVICE_CHANGED=true
fi

# Check if the proxy script changed compared to the currently installed copy.
if [[ ! -f "${PROXY_STABLE}" ]]; then
  PROXY_CHANGED=true
elif ! diff -q "${SCRIPT_DIR}/reverse-proxy.ts" "${PROXY_STABLE}" >/dev/null 2>&1; then
  PROXY_CHANGED=true
fi

if ! $SERVICE_CHANGED && ! $PROXY_CHANGED; then
  echo "Service files unchanged — nothing to update."
  exit 0
fi

if $SERVICE_CHANGED; then
  echo "Service unit changed — updating symlink and reloading daemon..."
  sudo ln -sf "${PROXY_SERVICE_SRC}" "${PROXY_SERVICE_DST}"
  echo "  Symlinked: ${PROXY_SERVICE_DST} -> ${PROXY_SERVICE_SRC}"
  sudo systemctl daemon-reload
  echo "  Daemon reloaded."
fi

if $PROXY_CHANGED; then
  echo "Proxy script changed — installing and restarting primordia-proxy..."
  cp "${SCRIPT_DIR}/reverse-proxy.ts" "${PROXY_STABLE}"
  echo "  Installed proxy script: ${PROXY_STABLE}"
  sudo systemctl restart primordia-proxy
  echo "  primordia-proxy restarted."
fi
