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
PROXY_SERVICE_DST="/etc/systemd/system/primordia-proxy.service"

REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Resolve the main (bare) checkout regardless of whether we are running from a
# linked worktree or from the main clone itself.
# In the main clone: `git rev-parse --git-common-dir` returns the relative path
# ".git", so REPO_ROOT is already the main checkout.
# In a linked worktree: it returns an absolute path like /home/…/primordia/.git,
# so the main checkout is its parent directory.
_GIT_COMMON_DIR=$(git -C "${REPO_ROOT}" rev-parse --git-common-dir 2>/dev/null || true)
if [[ "${_GIT_COMMON_DIR}" == /* ]]; then
  _MAIN_REPO="$(dirname "${_GIT_COMMON_DIR}")"
else
  _MAIN_REPO="${REPO_ROOT}"
fi
WORKTREES_DIR="$(cd "${_MAIN_REPO}/.." && pwd)/primordia-worktrees"
mkdir -p "${WORKTREES_DIR}"

echo "Installing Primordia systemd service..."

# ── Git config / port assignment (must run before any ownership changes) ──────
# These operations run as the installing user who currently owns the repo.

# Initialise primordia.productionBranch in git config so the reverse proxy knows
# which branch is production. Only set on first install — never overwrite a live value.
# Use the branch currently checked out in REPO_ROOT (e.g. curl-pipe-install-script
# when installed via a preview URL), falling back to main.
if ! git -C "${REPO_ROOT}" config --get primordia.productionBranch >/dev/null 2>&1; then
  _CURRENT_BRANCH=$(git -C "${REPO_ROOT}" symbolic-ref --short HEAD 2>/dev/null || echo "main")
  git -C "${REPO_ROOT}" config primordia.productionBranch "${_CURRENT_BRANCH}"
  git -C "${REPO_ROOT}" config --add primordia.productionHistory "${_CURRENT_BRANCH}"
  echo "  Initialized production branch → ${_CURRENT_BRANCH}"
else
  echo "  Production branch already set → $(git -C "${REPO_ROOT}" config --get primordia.productionBranch)"
fi

# Assign ports to all local branches (ensures branch.main.port = 3001 is set in git config).
bash "${SCRIPT_DIR}/assign-branch-ports.sh" "${REPO_ROOT}"

# ── Create dedicated primordia service user ───────────────────────────────────
# The proxy runs as 'primordia' — a dedicated system account with no login shell
# and no broad sudo access, reducing blast radius if the service is compromised.

if ! id primordia &>/dev/null; then
  sudo useradd --system --create-home --shell /bin/false \
               --comment "Primordia service account" primordia
  echo "  Created system user: primordia"
else
  echo "  System user 'primordia' already exists"
fi

# Add the installing user to the primordia group so they retain read/write
# access to repo files after the group is changed below.
INSTALL_USER="$(whoami)"
if [[ "${INSTALL_USER}" != "primordia" ]]; then
  sudo usermod -aG primordia "${INSTALL_USER}" 2>/dev/null || true
  echo "  Added ${INSTALL_USER} to primordia group (effective on next login)"
fi

# ── Install scoped sudoers for primordia ──────────────────────────────────────
# The primordia user needs sudo only for three specific commands:
#   1. systemctl daemon-reload   — when the service unit file is updated
#   2. systemctl restart primordia-proxy — for deploys and rollbacks
#   3. tee /etc/systemd/system/primordia-proxy.service — to update the unit file
# No other sudo access is granted.

sudo tee /etc/sudoers.d/primordia > /dev/null << 'SUDOERS'
# primordia service user — scoped to service management commands only
primordia ALL=(root) NOPASSWD: \
    /usr/bin/systemctl daemon-reload, \
    /usr/bin/systemctl restart primordia-proxy, \
    /usr/bin/tee /etc/systemd/system/primordia-proxy.service
SUDOERS
sudo chmod 0440 /etc/sudoers.d/primordia
echo "  Installed /etc/sudoers.d/primordia (scoped sudo for primordia user)"

# ── Transfer group ownership of repo and worktrees to primordia ───────────────
# The installing user (exedev) retains file ownership; group becomes primordia
# with group-write enabled, so the service user can also read and write.
# The setgid bit on directories ensures new files inherit the primordia group.

sudo chgrp -R primordia "${_MAIN_REPO}"
sudo chmod -R g+rwX "${_MAIN_REPO}"
sudo find "${_MAIN_REPO}" -type d -exec sudo chmod g+s {} \;
sudo chgrp -R primordia "${WORKTREES_DIR}"
sudo chmod -R g+rwX "${WORKTREES_DIR}"
sudo chmod g+s "${WORKTREES_DIR}"
echo "  Set group ownership: ${_MAIN_REPO} → primordia (g+rwXs)"
echo "  Set group ownership: ${WORKTREES_DIR} → primordia (g+rwXs)"

# ── Symlink bun into /usr/local/bin ──────────────────────────────────────────
# Spawned child processes (bun run start/dev) need bun on PATH even when
# PATH doesn't include ~/.bun/bin.
BUN_BIN="$HOME/.bun/bin/bun"
if [[ -f "$BUN_BIN" ]] && [[ ! -L /usr/local/bin/bun ]]; then
  sudo ln -sf "$BUN_BIN" /usr/local/bin/bun 2>/dev/null && echo "  Symlinked bun → /usr/local/bin/bun" || true
fi

# ── Kill any legacy nohup process so we don't double-run ─────────────────────
if [[ -f "$HOME/primordia.pid" ]]; then
  OLD_PID=$(cat "$HOME/primordia.pid" 2>/dev/null || true)
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "  Stopping legacy nohup process (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$HOME/primordia.pid"
fi

# ── Install the reverse proxy script to primordia's home ─────────────────────
# The proxy systemd unit references this stable absolute path.

PROXY_STABLE="/home/primordia/primordia-proxy.ts"
sudo cp "${SCRIPT_DIR}/reverse-proxy.ts" "${PROXY_STABLE}"
sudo chown primordia:primordia "${PROXY_STABLE}"
echo "  Installed proxy script: ${PROXY_STABLE}"

# ── Write stable env file for primordia ──────────────────────────────────────
# The service unit's EnvironmentFile must be a stable path (not inside a
# worktree that changes on each deploy). Extract REVERSE_PROXY_PORT from
# wherever install.sh wrote it and copy to primordia's home.

_PROXY_PORT="3000"
for _env_candidate in "${REPO_ROOT}/.env.local" "${_MAIN_REPO}/.env.local"; do
  if [[ -f "${_env_candidate}" ]]; then
    _port=$(grep "^REVERSE_PROXY_PORT=" "${_env_candidate}" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)
    if [[ -n "${_port}" ]]; then _PROXY_PORT="${_port}"; fi
    break
  fi
done
printf "# Stable env for Primordia service — managed by install-service.sh\nREVERSE_PROXY_PORT=%s\n" "${_PROXY_PORT}" \
  | sudo tee /home/primordia/.env.local > /dev/null
sudo chown primordia:primordia /home/primordia/.env.local
echo "  Wrote /home/primordia/.env.local (REVERSE_PROXY_PORT=${_PROXY_PORT})"

# ── Generate and install the systemd service unit ─────────────────────────────
# Written (not symlinked) so that the correct runtime paths are embedded.
# update-service.sh regenerates and compares this file on each deploy.

sudo tee "${PROXY_SERVICE_DST}" > /dev/null << SERVICE_UNIT
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
echo "  Generated: ${PROXY_SERVICE_DST}"

sudo systemctl daemon-reload
sudo systemctl enable primordia-proxy
echo "  Enabled on boot."

sudo systemctl restart primordia-proxy
