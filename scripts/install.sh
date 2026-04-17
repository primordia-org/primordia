#!/usr/bin/env bash
# scripts/install.sh
# Server-side Primordia setup script. Run inside the cloned repo on a VM.
#
# Typically invoked by scripts/install-for-exe-dev.sh (which handles VM creation
# and git clone). Can also be run manually after cloning:
#
#   git clone https://primordia.exe.xyz/api/git ~/primordia
#   cd ~/primordia
#   bash scripts/install.sh

set -euo pipefail

# ── Colours / formatting ──────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  BOLD="\033[1m"; GREEN="\033[0;32m"; CYAN="\033[0;36m"
  YELLOW="\033[0;33m"; RED="\033[0;31m"; DIM="\033[2m"; RESET="\033[0m"
else
  BOLD="" GREEN="" CYAN="" YELLOW="" RED="" DIM="" RESET=""
fi

# When called from install-for-exe-dev.sh, INSTALL_PREFIX="  " for visual nesting.
_PREFIX="${INSTALL_PREFIX:-}"

info()    { echo -e "${_PREFIX}${CYAN}▸${RESET} $*"; }
success() { echo -e "${_PREFIX}${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${_PREFIX}${YELLOW}⚠${RESET} $*"; }
die()     { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }
diag()    { echo -e "${_PREFIX}${DIM}  $*${RESET}"; }
# _step: print spinner line (no newline) — replaced by _done on success
# _done: stop spinner and overwrite line with ✓
# _spin_kill: stop spinner without printing a success line
_SPINNER_PID=""
_step() {
  local msg="$*"
  printf '%s\\ %s' "${_PREFIX}" "$msg"
  ( local i=1; local c='\|/-'
    while true; do sleep 0.12; printf '\r%s%s %s' "${_PREFIX}" "${c:$((i % 4)):1}" "$msg"; i=$((i+1)); done ) &
  _SPINNER_PID=$!
  disown "$_SPINNER_PID" 2>/dev/null || true
}
_done() {
  if [[ -n "${_SPINNER_PID:-}" ]]; then
    kill "$_SPINNER_PID" 2>/dev/null || true; wait "$_SPINNER_PID" 2>/dev/null || true; _SPINNER_PID=""
  fi
  printf "\r\033[K${_PREFIX}${GREEN}✓${RESET} %s\n" "$*"
}
_spin_kill() {
  if [[ -n "${_SPINNER_PID:-}" ]]; then
    kill "$_SPINNER_PID" 2>/dev/null || true; wait "$_SPINNER_PID" 2>/dev/null || true; _SPINNER_PID=""
  fi
  printf "\r\033[K"
}

# ── ERR trap ──────────────────────────────────────────────────────────────────

_CURRENT_STEP="(initialising)"
trap '_exit_code=$?
echo -e "\n${RED}✗ Install failed${RESET} at step: ${BOLD}${_CURRENT_STEP}${RESET} (line ${LINENO}, exit ${_exit_code})" >&2
echo "" >&2
echo -e "${DIM}  Service logs (last 30 lines):${RESET}" >&2
journalctl -u primordia-proxy -n 30 --no-pager 2>/dev/null >&2 || true
echo "" >&2
echo -e "${DIM}  Service status:${RESET}" >&2
systemctl status primordia-proxy --no-pager 2>/dev/null >&2 || true' ERR

# ── Locate repo root ──────────────────────────────────────────────────────────

_CURRENT_STEP="locate repo root"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REVERSE_PROXY_PORT="${REVERSE_PROXY_PORT:-3000}"

# ── Setup production worktree ─────────────────────────────────────────────────
# On a fresh install the repo is cloned to ~/primordia with 'main' checked out.
# git only allows a branch to be checked out in one place at a time, so we
# cannot create a worktree for 'main' inside primordia-worktrees/. Instead, ask
# git which other branches point at the same HEAD commit — the server keeps one
# such branch (the current production branch) — and create a worktree for it.
# All subsequent steps (bun install, bun run build, install-service.sh) run
# inside that worktree so the proxy and production server use the right path.

_CURRENT_STEP="setup production worktree"
WORKTREES_DIR="$(cd "${INSTALL_DIR}/.." && pwd)/primordia-worktrees"
mkdir -p "${WORKTREES_DIR}"

# A main checkout has a .git *directory*; a linked worktree has a .git *file*.
# Only redirect when we are in the main clone (not already running from a worktree).
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  _PROD_BRANCH=$(git -C "${INSTALL_DIR}" branch -r --points-at HEAD \
    | grep -v '\->' | grep -v '/main$' \
    | sed 's|[[:space:]]*origin/||' | head -1 | tr -d '[:space:]')

  if [[ -n "$_PROD_BRANCH" ]]; then
    _PROD_WORKTREE="${WORKTREES_DIR}/${_PROD_BRANCH}"
    if [[ ! -d "${_PROD_WORKTREE}" ]]; then
      _step "Creating production worktree '${_PROD_BRANCH}'..."
      # When installing from a preview/session branch URL, git clone checks out
      # that branch directly in the main clone. git worktree add then fails with
      # "already used by worktree". Fix: switch the main clone to main first so
      # the branch is free to be checked out in the new worktree.
      _MAIN_CLONE_BRANCH=$(git -C "${INSTALL_DIR}" symbolic-ref --short HEAD 2>/dev/null || echo "HEAD")
      if [[ "${_MAIN_CLONE_BRANCH}" == "${_PROD_BRANCH}" ]]; then
        # -B creates the branch if missing, resets it if it exists.
        git -C "${INSTALL_DIR}" checkout -B main origin/main
      fi
      # Create a local tracking branch from the remote ref and check it out in
      # the new worktree. Fall back to the existing local branch if it was
      # already created (e.g. a previous interrupted install attempt).
      if ! git -C "${INSTALL_DIR}" worktree add "${_PROD_WORKTREE}" \
             -b "${_PROD_BRANCH}" "origin/${_PROD_BRANCH}" 2>/dev/null; then
        git -C "${INSTALL_DIR}" worktree add "${_PROD_WORKTREE}" "${_PROD_BRANCH}"
      fi
      _done "Production worktree: ${_PROD_WORKTREE/#$HOME/~}"
    else
      success "Production worktree: ${_PROD_WORKTREE/#$HOME/~} (already exists)"
    fi
    INSTALL_DIR="${_PROD_WORKTREE}"
  else
    warn "No non-main branch found at HEAD — production will run from $(basename "${INSTALL_DIR}")"
  fi
fi

# ── Header (standalone mode only) ─────────────────────────────────────────────

if [[ -z "${INSTALL_PREFIX:-}" ]]; then
  echo ""
  echo -e "${BOLD}  Primordia Setup${RESET}"
  echo -e "  Repo: ${INSTALL_DIR}"
  echo ""
  diag "--- Server diagnostics (paste this if something goes wrong) ---"
  diag "Date:      $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  diag "Hostname:  $(hostname -f 2>/dev/null || hostname)"
  diag "OS:        $(uname -srm)"
  if [[ -f /etc/os-release ]]; then
    diag "Distro:    $(. /etc/os-release && echo "${PRETTY_NAME:-$ID}")"
  fi
  diag "User:      $(whoami)"
  diag "Disk:      $(df -h "${INSTALL_DIR}" 2>/dev/null | awk 'NR==2{print $4" free of "$2}' || echo 'unknown')"
  diag "Memory:    $(free -h 2>/dev/null | awk '/^Mem:/{print $7" free of "$2}' || echo 'unknown')"
  diag "Repo:      $(git -C "${INSTALL_DIR}" log -1 --oneline 2>/dev/null || echo 'unknown')"
  diag "--------------------------------------------------------------"
  echo ""
fi

# ── Detect exe.dev ────────────────────────────────────────────────────────────

_CURRENT_STEP="detect exe.dev"
HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
if [[ "$HOSTNAME_FQDN" == *.exe.xyz ]]; then
  info "Detected exe.dev host: ${HOSTNAME_FQDN}"
  APP_URL="https://${HOSTNAME_FQDN}"
else
  warn "Not running on exe.dev — SSO login and the LLM gateway won't be available."
  APP_URL="http://localhost:${REVERSE_PROXY_PORT}"
fi
[[ -z "${INSTALL_PREFIX:-}" ]] && echo ""

# ── Install bun ───────────────────────────────────────────────────────────────

_CURRENT_STEP="install bun"
export PATH="$HOME/.bun/bin:$PATH"
if ! command -v bun &>/dev/null; then
  _step "Installing bun..."
  _bun_install_log=$(mktemp)
  if ! curl -fsSL https://bun.sh/install | bash >"$_bun_install_log" 2>&1; then
    cat "$_bun_install_log" >&2
    rm -f "$_bun_install_log"
    die "bun installation failed"
  fi
  rm -f "$_bun_install_log"
  export PATH="$HOME/.bun/bin:$PATH"
  _done "Installed bun $(bun --version)"
else
  success "bun $(bun --version) already installed"
fi

# ── Write .env.local ──────────────────────────────────────────────────────────

_CURRENT_STEP="write .env.local"
ENV_FILE="${INSTALL_DIR}/.env.local"
if [[ ! -f "${ENV_FILE}" ]]; then
  cat > "${ENV_FILE}" << EOF
# Generated by Primordia installer — $(date -u '+%Y-%m-%d %H:%M:%S UTC')
REVERSE_PROXY_PORT=${REVERSE_PROXY_PORT}
EOF
  success "Wrote ${ENV_FILE/#$HOME/~}"
fi

# ── Wait for DNS / outbound internet ─────────────────────────────────────────
# Fresh VMs: systemd-resolved starts before the NIC is ready, leaving DNS
# broken for up to 120 s. Detect and fix before running bun install.

_CURRENT_STEP="wait for DNS"
_dns_check() { getent hosts registry.npmjs.org >/dev/null 2>&1; }

if ! _dns_check; then
  info "DNS not ready — attempting to fix (systemd-resolved race on fresh VMs)..."

  if command -v systemd-networkd-wait-online &>/dev/null; then
    sudo systemd-networkd-wait-online --timeout=30 2>/dev/null || true
  fi
  sudo resolvectl flush-caches 2>/dev/null || true
  if ! grep -q "127.0.0.53" /etc/resolv.conf 2>/dev/null; then
    sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf 2>/dev/null || true
  fi
  if resolvectl status 2>/dev/null | grep -q "Current Scopes: none"; then
    sudo systemctl restart systemd-networkd 2>/dev/null || true
    sudo systemd-networkd-wait-online --timeout=15 2>/dev/null || sleep 5
    sudo systemctl restart systemd-resolved 2>/dev/null || true
    sleep 2
  fi

  _DNS_OK=false
  for _i in $(seq 1 30); do
    if _dns_check; then _DNS_OK=true; break; fi
    sleep 2
  done
  if [[ "$_DNS_OK" != "true" ]]; then
    warn "DNS still broken — falling back to public DNS (1.1.1.1 / 8.8.8.8)"
    echo -e "nameserver 1.1.1.1\nnameserver 8.8.8.8" | sudo tee /etc/resolv.conf >/dev/null
    sleep 1
  fi
fi

# ── Install dependencies ──────────────────────────────────────────────────────

_CURRENT_STEP="bun install"
_step "bun install..."
cd "${INSTALL_DIR}"
_bun_log=$(mktemp)
_BUN_OK=false
for _attempt in 1 2 3; do
  if bun install --frozen-lockfile >> "$_bun_log" 2>&1; then
    _BUN_OK=true; break
  fi
  if [[ $_attempt -lt 3 ]]; then sleep 15; fi
done
if [[ "$_BUN_OK" != "true" ]]; then
  diag "npm registry: $(curl -fsS --max-time 5 https://registry.npmjs.org/ >/dev/null 2>&1 && echo 'reachable' || echo 'UNREACHABLE')"
  echo -e "${DIM}  --- bun install output ---${RESET}" >&2
  tail -60 "$_bun_log" >&2
  echo -e "${DIM}  --------------------------${RESET}" >&2
  rm -f "$_bun_log"; exit 1
fi
rm -f "$_bun_log"
_done "Dependencies installed"

# ── Build production bundle ───────────────────────────────────────────────────

_CURRENT_STEP="bun run build"
_step "bun run build..."
_build_log=$(mktemp)
if ! bun run build > "$_build_log" 2>&1; then
  printf "\n"
  echo -e "${DIM}  --- build output ---${RESET}" >&2
  cat "$_build_log" >&2
  echo -e "${DIM}  --------------------${RESET}" >&2
  rm -f "$_build_log"; exit 1
fi
rm -f "$_build_log"
_done "Build complete"

# ── Install systemd service ───────────────────────────────────────────────────

_CURRENT_STEP="install systemd service"
echo ""
echo "Finally, let's ensure Primordia is automatically started on boot:"
echo ""
_step "Running ${INSTALL_DIR/#$HOME/~}/scripts/install-service.sh..."
_svc_log=$(mktemp)
if ! bash "${INSTALL_DIR}/scripts/install-service.sh" > "$_svc_log" 2>&1; then
  printf "\n"
  cat "$_svc_log" >&2
  rm -f "$_svc_log"
  exit 1
fi
rm -f "$_svc_log"
_done "Installed primordia-proxy systemd service and enabled on boot"
if systemctl is-active --quiet primordia-proxy 2>/dev/null; then
  success "Started primordia-proxy systemd service"
fi

# ── Wait for ready ────────────────────────────────────────────────────────────
# Poll HTTP directly — more reliable than scraping logs.

_CURRENT_STEP="wait for service ready"
echo ""
_step "Waiting for Primordia to be ready..."
SERVICE_READY=false
for i in $(seq 1 60); do
  sleep 2
  if curl -sf --max-time 3 "http://localhost:${REVERSE_PROXY_PORT}/" -o /dev/null 2>/dev/null; then
    SERVICE_READY=true
    break
  fi
done

if [[ "$SERVICE_READY" == "true" ]]; then
  _spin_kill
  echo -e "${GREEN}✓${RESET} Congratulations! Primordia is running!"
else
  _spin_kill
  warn "Service did not respond within 120 s — it may still be starting."
  echo ""
  echo -e "${DIM}  --- Last 40 lines of service log ---${RESET}"
  journalctl -u primordia-proxy -n 40 --no-pager 2>/dev/null || true
  echo -e "${DIM}  --- Service status ---${RESET}"
  systemctl status primordia-proxy --no-pager 2>/dev/null || true
  echo -e "${DIM}  -------------------------------------${RESET}"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "Open:     ${BOLD}${APP_URL}${RESET}"
echo ""
if [[ "$HOSTNAME_FQDN" == *.exe.xyz ]]; then
  echo "Sign in with your exe.dev account on the login page."
  echo "The first user to sign in is automatically granted the admin role."
  echo "You will be prompted for additional setup information when required."
else
  echo "Register a passkey on the login page."
  echo "The first user to register is automatically granted the admin role."
fi
echo ""
