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

echo "Installing Primordia systemd service..."

# Symlink the service file from the repo into systemd
sudo ln -sf "${SERVICE_SRC}" "${SERVICE_DST}"
echo "  Symlinked: ${SERVICE_DST} -> ${SERVICE_SRC}"

sudo systemctl daemon-reload
sudo systemctl enable primordia
echo "  Enabled on boot."

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
echo ""
echo "Done! Useful commands:"
echo "  sudo systemctl restart primordia    # restart"
echo "  sudo systemctl stop primordia       # stop"
echo "  sudo systemctl status primordia     # status"
echo "  journalctl -u primordia -f          # tail logs"
