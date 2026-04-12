#!/usr/bin/env bash
# scripts/install-service.sh
# First-time installation of the Primordia reverse-proxy systemd service.
# Run once on the server after cloning the repo.
#
# For subsequent deploys, use scripts/update-service.sh instead — it only
# runs daemon-reload / restart when the relevant files actually changed.
#
# The proxy is the only long-running systemd service. It is responsible for:
#   - Reading primordia.productionBranch from git config to determine the production branch/port.
#   - Starting the production Next.js server on boot (if not already running).
#   - Zero-downtime blue/green traffic cutover via git config updates.
#
# Usage:
#   bash scripts/install-service.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_SERVICE_SRC="${SCRIPT_DIR}/primordia-proxy.service"
PROXY_SERVICE_DST="/etc/systemd/system/primordia-proxy.service"

REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKTREES_DIR="${REPO_ROOT}/../primordia-worktrees"
mkdir -p "${WORKTREES_DIR}"

echo "Installing Primordia systemd service..."

# Symlink the proxy service unit file from the repo into systemd.
sudo ln -sf "${PROXY_SERVICE_SRC}" "${PROXY_SERVICE_DST}"
echo "  Symlinked: ${PROXY_SERVICE_DST} -> ${PROXY_SERVICE_SRC}"

# Install the reverse proxy script to a stable absolute path.
# The proxy systemd unit (primordia-proxy.service) references this path directly,
# so the service file never needs to follow a symlink to find the script.
PROXY_STABLE="$HOME/primordia-proxy.ts"
cp "${SCRIPT_DIR}/reverse-proxy.ts" "${PROXY_STABLE}"
echo "  Installed proxy script: ${PROXY_STABLE}"

# Initialise primordia.productionBranch in git config so the reverse proxy knows
# which branch is production. Only set on first install — never overwrite a live value.
if ! git -C "${REPO_ROOT}" config --get primordia.productionBranch >/dev/null 2>&1; then
  git -C "${REPO_ROOT}" config primordia.productionBranch main
  git -C "${REPO_ROOT}" config --add primordia.productionHistory main
  echo "  Initialized production branch → main"
else
  echo "  Production branch already set → $(git -C "${REPO_ROOT}" config --get primordia.productionBranch)"
fi

# Assign ports to all local branches (ensures branch.main.port = 3001 is set in git config).
bash "${SCRIPT_DIR}/assign-branch-ports.sh" "${REPO_ROOT}"

# Symlink bun into /usr/local/bin so spawned child processes (bun run start/dev)
# can find it even when PATH doesn't include ~/.bun/bin.
BUN_BIN="$HOME/.bun/bin/bun"
if [[ -f "$BUN_BIN" ]] && [[ ! -L /usr/local/bin/bun ]]; then
  sudo ln -sf "$BUN_BIN" /usr/local/bin/bun 2>/dev/null && echo "  Symlinked bun → /usr/local/bin/bun" || true
fi

# Kill any legacy nohup process so we don't double-run.
if [[ -f "$HOME/primordia.pid" ]]; then
  OLD_PID=$(cat "$HOME/primordia.pid" 2>/dev/null || true)
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "  Stopping legacy nohup process (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$HOME/primordia.pid"
fi

sudo systemctl daemon-reload
sudo systemctl enable primordia-proxy
echo "  Enabled on boot."

sudo systemctl restart primordia-proxy
echo ""
echo "Done! Useful commands:"
echo "  sudo systemctl restart primordia-proxy  # restart proxy (also restarts prod app if down)"
echo "  sudo systemctl stop primordia-proxy     # stop proxy"
echo "  sudo systemctl status primordia-proxy   # proxy status"
echo "  journalctl -u primordia-proxy -f        # tail proxy logs"
