#!/usr/bin/env bash
# scripts/install-service.sh
# Installs (or re-installs) the Primordia systemd service via symlink.
# Run once on the server after cloning/updating the repo.
#
# Usage: bash scripts/install-service.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SRC="${SCRIPT_DIR}/primordia.service"
SERVICE_DST="/etc/systemd/system/primordia.service"
PROXY_SERVICE_SRC="${SCRIPT_DIR}/primordia-proxy.service"
PROXY_SERVICE_DST="/etc/systemd/system/primordia-proxy.service"

echo "Installing Primordia systemd services..."

# Symlink the app service file from the repo into systemd
sudo ln -sf "${SERVICE_SRC}" "${SERVICE_DST}"
echo "  Symlinked: ${SERVICE_DST} -> ${SERVICE_SRC}"

# Symlink the proxy service file from the repo into systemd
sudo ln -sf "${PROXY_SERVICE_SRC}" "${PROXY_SERVICE_DST}"
echo "  Symlinked: ${PROXY_SERVICE_DST} -> ${PROXY_SERVICE_SRC}"

sudo systemctl daemon-reload
sudo systemctl enable primordia
sudo systemctl enable primordia-proxy
echo "  Enabled on boot."

# Blue/green production slot: ensure primordia-worktrees/current symlink exists.
# On first install it points at the main repo directory.
# After the first accepted evolve session it will point at the winning worktree,
# so re-running this script must NOT clobber a live green slot.
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKTREES_DIR="${REPO_ROOT}/../primordia-worktrees"
CURRENT_LINK="${WORKTREES_DIR}/current"

mkdir -p "${WORKTREES_DIR}"
if [[ ! -e "${CURRENT_LINK}" && ! -L "${CURRENT_LINK}" ]]; then
  ln -sfn "${REPO_ROOT}" "${CURRENT_LINK}"
  echo "  Created production slot: ${CURRENT_LINK} -> ${REPO_ROOT}"
else
  echo "  Production slot exists: ${CURRENT_LINK} -> $(readlink "${CURRENT_LINK}")"
fi

# Initialise the PROD symbolic-ref so the reverse proxy knows which branch is
# production. Only set on first install — never overwrite a live PROD pointer.
if ! git -C "${REPO_ROOT}" symbolic-ref PROD >/dev/null 2>&1; then
  git -C "${REPO_ROOT}" symbolic-ref PROD refs/heads/main
  echo "  Initialized PROD symbolic-ref → refs/heads/main"
else
  echo "  PROD symbolic-ref already set → $(git -C "${REPO_ROOT}" symbolic-ref --short PROD)"
fi

# Kill any legacy nohup process so we don't double-run
if [[ -f "$HOME/primordia.pid" ]]; then
  OLD_PID=$(cat "$HOME/primordia.pid" 2>/dev/null || true)
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "  Stopping legacy nohup process (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$HOME/primordia.pid"
fi

sudo systemctl restart primordia
sudo systemctl restart primordia-proxy
echo ""
echo "Done! Useful commands:"
echo "  sudo systemctl restart primordia        # restart app"
echo "  sudo systemctl restart primordia-proxy  # restart proxy"
echo "  sudo systemctl stop primordia           # stop app"
echo "  sudo systemctl status primordia         # app status"
echo "  sudo systemctl status primordia-proxy   # proxy status"
echo "  journalctl -u primordia -f              # tail app logs"
echo "  journalctl -u primordia-proxy -f        # tail proxy logs"
