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

# macOS (and other non-systemd platforms) do not have systemctl.
# Nothing to update — exit cleanly.
if ! command -v systemctl &>/dev/null; then
  echo "systemctl not available — skipping service update."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_SERVICE_DST="/etc/systemd/system/primordia-proxy.service"
PROXY_STABLE="/home/primordia/primordia-proxy.ts"

# Resolve WORKTREES_DIR the same way install-service.sh does, so the generated
# service unit content stays consistent across installs and updates.
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
_GIT_COMMON_DIR=$(git -C "${REPO_ROOT}" rev-parse --git-common-dir 2>/dev/null || true)
if [[ "${_GIT_COMMON_DIR}" == /* ]]; then
  _MAIN_REPO="$(dirname "${_GIT_COMMON_DIR}")"
else
  _MAIN_REPO="${REPO_ROOT}"
fi
WORKTREES_DIR="$(cd "${_MAIN_REPO}/.." && pwd)/primordia-worktrees"

# Generate the expected service unit content (same template as install-service.sh).
_expected_service() {
  cat << SERVICE_UNIT
[Unit]
Description=Primordia Reverse Proxy
After=network.target

[Service]
Type=simple
User=primordia
WorkingDirectory=/home/primordia
EnvironmentFile=/home/primordia/.env.local
Environment=PRIMORDIA_WORKTREES_DIR=${WORKTREES_DIR}
Environment=HOME=/home/primordia
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/bun ${PROXY_STABLE}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE_UNIT
}

SERVICE_CHANGED=false
PROXY_CHANGED=false

# Check if the service unit content changed compared to the installed copy.
if [[ ! -e "${PROXY_SERVICE_DST}" ]]; then
  SERVICE_CHANGED=true
else
  INSTALLED_SERVICE=$(cat "${PROXY_SERVICE_DST}" 2>/dev/null || true)
  EXPECTED_SERVICE=$(_expected_service)
  if [[ "${INSTALLED_SERVICE}" != "${EXPECTED_SERVICE}" ]]; then
    SERVICE_CHANGED=true
  fi
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
  echo "Service unit changed — updating and reloading daemon..."
  _expected_service | sudo tee "${PROXY_SERVICE_DST}" > /dev/null
  echo "  Written: ${PROXY_SERVICE_DST}"
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
