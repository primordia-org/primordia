#!/usr/bin/env bash
# scripts/install.sh
# Primordia setup script. It supports two methods of running. Invoking it 
# directly, e.g.
#
#   bash scripts/install.sh
#
# or alternately piping the contents to bash
#
#   curl https://primordia.exe.xyz/install.sh | bash
#
# The installer is idempotent and is safe to run multiple times, including
# recovering from aborted runs.
#
# The installer doubles as an updater script, and is used to update existing
# Primordia instances.

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# ── Colours / formatting ──────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  BOLD="\033[1m"; GREEN="\033[0;32m"; CYAN="\033[0;36m"
  YELLOW="\033[0;33m"; RED="\033[0;31m"; DIM="\033[2m"; RESET="\033[0m"
else
  BOLD="" GREEN="" CYAN="" YELLOW="" RED="" DIM="" RESET=""
fi

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
die()     { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }
diag()    { echo -e "${DIM}  $*${RESET}"; }
# _step: print spinner line (no newline) — replaced by _done on success
# _done: stop spinner and overwrite line with ✓
# _spin_kill: stop spinner without printing a success line
_SPINNER_PID=""
_step() {
  local msg="$*"
  printf '%s\\ %s' "$msg"
  ( local i=1; local c='\|/-'
    while true; do sleep 0.12; printf '\r%s%s %s' "${c:$((i % 4)):1}" "$msg"; i=$((i+1)); done ) &
  _SPINNER_PID=$!
  disown "$_SPINNER_PID" 2>/dev/null || true
}
_done() {
  if [[ -n "${_SPINNER_PID:-}" ]]; then
    kill "$_SPINNER_PID" 2>/dev/null || true; wait "$_SPINNER_PID" 2>/dev/null || true; _SPINNER_PID=""
  fi
  printf "\r\033[K${GREEN}✓${RESET} %s\n" "$*"
}
_spin_kill() {
  if [[ -n "${_SPINNER_PID:-}" ]]; then
    kill "$_SPINNER_PID" 2>/dev/null || true; wait "$_SPINNER_PID" 2>/dev/null || true; _SPINNER_PID=""
  fi
  printf "\r\033[K"
}

# ── Server diagnostics ────────────────────────────────────────────────────────

diag "--- Server diagnostics (paste this if something goes wrong) ---"
diag "Date:      $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
diag "Hostname:  $(hostname -f 2>/dev/null || hostname)"
diag "OS:        $(uname -srm)"
if [[ -f /etc/os-release ]]; then
  diag "Distro:    $(. /etc/os-release && echo "${PRETTY_NAME:-$ID}")"
fi
diag "User:      $(whoami)"
diag "Disk:      $(df -h "${PRIMORDIA_DIR}" 2>/dev/null | awk 'NR==2{print $4" free of "$2}' || echo 'unknown')"
diag "Memory:    $(free -h 2>/dev/null | awk '/^Mem:/{print $7" free of "$2}' || echo 'unknown')"
diag "Repo:      $(git -C "${BARE_REPO}" log -1 --oneline 2>/dev/null || echo 'unknown')"
diag "--------------------------------------------------------------"
echo ""

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

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
cat << 'ASCII'
  ___     _                  _ _
 | _ \_ _(_)_ __  ___ _ _ __| (_)__ _
 |  _/ '_| | '  \/ _ \ '_/ _` | / _` |
 |_| |_| |_|_|_|_\___/_| \__,_|_\__,_|

          . _  __|_ _ || _  _
          || |_\ | (_|||(/_|

ASCII

# ── Install git ───────────────────────────────────────────────────────────────

_CURRENT_STEP="ensure git is available"
if ! command -v git &>/dev/null; then
  _step "Installing git..."
  sudo apt-get update -qq </dev/null >/dev/null 2>&1
  sudo apt-get install -y git </dev/null >/dev/null 2>&1
  _done "Using git $(git --version | awk '{print $3}')"
else
  success "Using git $(git --version | awk '{print $3}')"
fi

# ── Locate directories ────────────────────────────────────────────────────────

_CURRENT_STEP="Locate directories"
SCRIPT_DIR=""
if [[ "${BASH_SOURCE[0]}" != "bash" && "${BASH_SOURCE[0]}" != "-bash" && -n "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [[ -n "$SCRIPT_DIR" ]] && git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
  WORKTREES_DIR="$(dirname "$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)")"
  PRIMORDIA_DIR="$(dirname "${WORKTREES_DIR}")"
  if [[ -z "$1" ]]; then
    BRANCH="$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD)"
  elif [[ "$BRANCH" != "$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD)" ]]; then
    die "Error: branch argument '$BRANCH' does not match worktree branch"
  fi
  success "Using ${PRIMORDIA_DIR}"
else
  PRIMORDIA_DIR="$(pwd)/primordia"
  WORKTREES_DIR="${PRIMORDIA_DIR}/worktrees"
  mkdir -p "$WORKTREES_DIR"
  success "Created ${PRIMORDIA_DIR}"
fi

# ── Clone Primordia ───────────────────────────────────────────────────────────

_CURRENT_STEP="Clone primordia"
BARE_REPO="${PRIMORDIA_DIR}/source.git"
if [[ ! -d "${BARE_REPO}" ]]; then
  _step "Cloning Primordia..."
  _log=$(mktemp)
  if ! git clone --bare https://primordia.exe.xyz/api/git "${BARE_REPO}" >"$_log" 2>&1; then _spin_kill; cat "$_log" >&2; rm -f "$_log"; exit 1; fi
  rm -f "$_log"
  _done "Cloned to ${BARE_REPO}"
fi

if [[ -z "$(git -C "${BARE_REPO}" config --local user.name)" ]]; then
  git -C "${BARE_REPO}" config --local user.name  "Primordia"
fi

if [[ -z "$(git -C "${BARE_REPO}" config --local user.email)" ]]; then
  git -C "${BARE_REPO}" config --local user.email "primordia@localhost"
fi

# ── Calculate branch name ─────────────────────────────────────────────────────

_CURRENT_STEP="Calculate branch name"
if [[ -z "$1" ]]; then
  # Find the remote branch that points to the same commit as origin/main
  BRANCH="$(git -C "${BARE_REPO}" branch -r --points-at "$(git -C "${BARE_REPO}" rev-parse origin/main)" | grep -v 'origin/main' | head -1 | sed 's|origin/||')"
else
  # Branch name provided to installer
  BRANCH="$1"
fi

# Confirm such a branch exists
if ! git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  die "Branch not found: ${BRANCH}"
fi

success "Branch: ${branch}"

# ── Create worktree ───────────────────────────────────────────────────────────

_CURRENT_STEP="Create worktree"
INSTALL_DIR="${WORKTREES_DIR}/${BRANCH}"
if [[ -d "${INSTALL_DIR}" ]]; then
  success "Using existing worktree"
else
  _step "Creating worktree..."
  # Create a local tracking branch from the remote ref and check it out in
  # the new worktree.
  git -C "${BARE_REPO}" worktree add "${INSTALL_DIR}" \
      -b "${BRANCH}" "origin/${BRANCH}" 2>/dev/null;
  _done "Worktree created"
fi

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
  _done "Using bun $(bun --version)"
else
  success "Using bun $(bun --version)"
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

# ── Install dependencies ──────────────────────────────────────────────────────

_CURRENT_STEP="bun install"
_step "bun install..."
cd "${INSTALL_DIR}"
_bun_log=$(mktemp)
_BUN_OK=false
if bun install --frozen-lockfile >> "$_bun_log" 2>&1; then
  _BUN_OK=true;
fi
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

# ── Install reverse-proxy ─────────────────────────────────────────────────────

_CURRENT_STEP="install reverse proxy"
REVERSE_PROXY_SOURCE="${INSTALL_DIR}/scripts/reverse-proxy.ts"
REVERSE_PROXY_DEST="${PRIMORDIA_DIR}/reverse-proxy.ts"

# Calculate if the proxy script needs updating
if [[ ! -f "${REVERSE_PROXY_DEST}" ]]; then
  PROXY_CHANGED=true
elif ! diff -q "${REVERSE_PROXY_SOURCE}" "${REVERSE_PROXY_DEST}" >/dev/null 2>&1; then
  PROXY_CHANGED=true
fi

if $PROXY_CHANGED; then
  cp -f "${REVERSE_PROXY_SOURCE}" "${REVERSE_PROXY_DEST}"
  success "Installed reverse-proxy.ts"
else
  success "Using reverse-proxy.ts"
fi

# ── Determine hostname ────────────────────────────────────────────────────────

_CURRENT_STEP="determine hostname"
HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
REVERSE_PROXY_PORT=8000

if [[ "$HOSTNAME_FQDN" == *.local || "$HOSTNAME_FQDN" == *.lan || "$HOSTNAME_FQDN" == "localhost" ]]; then
  info "No domain name detected. Assuming localhost."
  APP_URL="http://localhost:${REVERSE_PROXY_PORT}"
  PROBABLY_A_SERVER=false
elif [[ "$HOSTNAME_FQDN" == *.exe.xyz ]]; then
  info "Detected exe.dev host: ${HOSTNAME_FQDN}"
  APP_URL="https://${HOSTNAME_FQDN}"
  PROBABLY_A_SERVER=true
else
  warn "Not running on exe.dev — automatic SSL termination, exe.dev login, and LLM gateway integration won't be available."
  APP_URL="http://${HOSTNAME_FQDN}:${REVERSE_PROXY_PORT}"
  PROBABLY_A_SERVER=true
fi

# ── Install systemd service ───────────────────────────────────────────────────

_CURRENT_STEP="install systemd service"

if [[ "$PROBABLY_A_SERVER" == "true" && command -v systemctl &>/dev/null ]]; then
  # Determine if systemd of something else
  success "Using systemd v$(systemctl --version | awk 'NR==1 {print $2}')"
  _step "Installing systemd service..."
  # Check if we have write access to the system systemd directory
  if [[ -w /etc/systemd/system ]]; then
    SYSTEMD_SERVICE_DIR="/etc/systemd/system"
    SYSTEMCTL="systemctl"
  else
    # otherwise fall back to the user directory:
    SYSTEMD_SERVICE_DIR="${HOME}/.config/systemd/user"
    SYSTEMCTL="systemctl --user"
    mkdir -p "$SYSTEMD_SERVICE_DIR"
  fi
  PROXY_SERVICE_DST="${SYSTEMD_SERVICE_DIR}/primordia.service"
  BUN_DIR="$(dirname "$(command -v bun)")"
  GENERATED_UNIT=$(cat << UNIT
[Unit]
Description=Primordia Reverse Proxy
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${PRIMORDIA_DIR}
EnvironmentFile=${PRIMORDIA_DIR}/.env.local
Environment=PRIMORDIA_WORKTREES_DIR=${WORKTREES_DIR}
Environment=HOME=${HOME}
Environment=PATH=${BUN_DIR}:/usr/local/bin:/usr/bin:/bin
ExecStart=${BUN_DIR}/bun ${PRIMORDIA_DIR}/reverse-proxy.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT)

  # Calculate if the service needs updating
  if [[ ! -f "${PROXY_SERVICE_DST}" ]]; then
    SERVICE_CHANGED=true
    DAEMON_RELOAD=false
  elif ! diff -q <(echo "$GENERATED_UNIT") "${PROXY_SERVICE_DST}" >/dev/null 2>&1; then
    SERVICE_CHANGED=true
    DAEMON_RELOAD=true
  else
    SERVICE_CHANGED=false
    DAEMON_RELOAD=false
  fi

  # Install/update the service
  if $SERVICE_CHANGED; then
    echo "$GENERATED_UNIT" > "${PROXY_SERVICE_DST}"
    if $DAEMON_RELOAD; then
      $SYSTEMCTL daemon-reload
    fi
  fi

  # Start/restart the service
  if [[ "$PROXY_CHANGED" == true || "$SERVICE_CHANGED" == true ]]; then
    _done "Installed primordia systemd service"
    if $SYSTEMCTL is-active --quiet primordia; then
      $SYSTEMCTL restart primordia
    else
      $SYSTEMCTL start primordia
    fi
  else
    _done "Using primorida systemd service"
  fi

  if $SYSTEMCTL is-active --quiet primordia 2>/dev/null; then
    success "Started primordia systemd service"
  fi
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
