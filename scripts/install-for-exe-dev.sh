#!/usr/bin/env bash
# scripts/install-for-exe-dev.sh
# Run this on your personal computer to create a new Primordia VM on exe.dev.
#
# Usage:
#   curl -fsSL https://primordia.exe.xyz/install-for-exe-dev.sh | bash
#
# Prerequisites:
#   - An exe.dev account with SSH access configured
#   - ssh exe.dev must work without a password prompt
#     (see https://exe.dev/docs/ssh.md for setup instructions)

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────

if [[ -t 1 ]] || [[ -e /dev/tty ]]; then
  BOLD="\033[1m"
  GREEN="\033[0;32m"
  CYAN="\033[0;36m"
  YELLOW="\033[0;33m"
  RED="\033[0;31m"
  DIM="\033[2m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" CYAN="" YELLOW="" RED="" DIM="" RESET=""
fi

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
die()     { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }
diag()    { echo -e "${DIM}  $*${RESET}"; }

# Spinner: start_spinner "message"  → sets _SPINNER_PID; stop_spinner cleans up.
_SPINNER_PID=""
start_spinner() {
  local msg="$*"
  ( while true; do printf "."; sleep 1; done ) &
  _SPINNER_PID=$!
  disown "$_SPINNER_PID" 2>/dev/null || true
  printf "${CYAN}▸${RESET} %s" "$msg"
}
stop_spinner() {
  if [[ -n "$_SPINNER_PID" ]]; then
    kill "$_SPINNER_PID" 2>/dev/null || true
    wait "$_SPINNER_PID" 2>/dev/null || true
    _SPINNER_PID=""
  fi
  echo ""
}

# ── ERR trap ──────────────────────────────────────────────────────────────────
# Prints context when any command exits with a non-zero status.

_CURRENT_STEP="(initialising)"

trap 'echo -e "\n${RED}✗ Install failed${RESET} at step: ${BOLD}${_CURRENT_STEP}${RESET} (line ${LINENO})" >&2
echo -e "${DIM}  Re-run with:  bash -x install-for-exe-dev.sh  for verbose output${RESET}" >&2' ERR

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}  Primordia Installer for exe.dev${RESET}"
echo -e "  Creates a new VM in your exe.dev account and installs Primordia."
echo ""

# ── Diagnostics header ────────────────────────────────────────────────────────

_CURRENT_STEP="diagnostics"
diag "--- Diagnostics (paste this if something goes wrong) ---"
diag "Date:      $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
diag "OS:        $(uname -srm 2>/dev/null || echo 'unknown')"
if [[ -f /etc/os-release ]]; then
  diag "Distro:    $(. /etc/os-release && echo "${PRETTY_NAME:-$ID}")"
fi
diag "Shell:     ${SHELL:-unknown}  (bash ${BASH_VERSION})"
diag "User:      $(whoami)@$(hostname)"
diag "SSH:       $(ssh -V 2>&1 | head -1)"
# List public key filenames (no private key content)
SSH_KEYS=$(ls ~/.ssh/*.pub 2>/dev/null | xargs -I{} basename {} .pub | tr '\n' ' ' || echo "none found")
diag "SSH keys:  ${SSH_KEYS}"
diag "ssh-agent: ${SSH_AUTH_SOCK:-(not set)}"
diag "--------------------------------------------------------"
echo ""

# ── Check prerequisites ───────────────────────────────────────────────────────

_CURRENT_STEP="check prerequisites"
command -v ssh &>/dev/null || die "ssh is required but not found."

# ── Test exe.dev SSH access ───────────────────────────────────────────────────

_CURRENT_STEP="check exe.dev SSH"
info "Checking exe.dev SSH access..."
SSH_TEST_OUTPUT=$(ssh -n -o BatchMode=yes -o ConnectTimeout=10 exe.dev help 2>&1) || {
  echo ""
  echo -e "${DIM}  ssh output: ${SSH_TEST_OUTPUT}${RESET}" >&2
  die "Cannot connect to exe.dev via SSH.

  Set up SSH access first:
    1. Generate a key:  ssh-keygen -t ed25519
    2. Add it at:       https://exe.dev/settings
    3. Test it:         ssh exe.dev help"
}
success "Connected to exe.dev"
echo ""

# ── Prompt for VM name ────────────────────────────────────────────────────────

_CURRENT_STEP="prompt VM name"
VM_NAME="primordia"
if [[ -e /dev/tty ]]; then
  # Read from the terminal even when the script is piped through bash.
  # Print the prompt explicitly to /dev/tty — 'read -p' sends its prompt to
  # stderr, which we suppress elsewhere, so the user would see nothing.
  printf "  VM name [primordia]: " >/dev/tty
  read -r _input </dev/tty || true
  VM_NAME="${_input:-primordia}"
fi
info "VM name: ${BOLD}${VM_NAME}${RESET}"
echo ""

# ── Create VM ─────────────────────────────────────────────────────────────────

_CURRENT_STEP="create VM"
diag "Running: ssh exe.dev new --name=${VM_NAME} --json"
start_spinner "Creating VM '${VM_NAME}' on exe.dev..."
VM_JSON=$(ssh -n -o BatchMode=yes exe.dev new "--name=${VM_NAME}" --json 2>&1) || {
  stop_spinner
  echo -e "${DIM}  Raw output:\n${VM_JSON}${RESET}" >&2
  die "Failed to create VM — see raw output above."
}
stop_spinner
diag "VM JSON response: ${VM_JSON}"
success "VM '${VM_NAME}' created"

# Parse the public hostname and proxy port from the JSON response
_CURRENT_STEP="parse VM JSON"
VM_HOST=""
PROXY_PORT=""
if command -v python3 &>/dev/null; then
  VM_HOST=$(python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('ssh_dest',''))" \
    <<< "$VM_JSON" 2>/dev/null || true)
  PROXY_PORT=$(python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('proxy_port',''))" \
    <<< "$VM_JSON" 2>/dev/null || true)
fi
if [[ -z "$VM_HOST" ]] && command -v jq &>/dev/null; then
  VM_HOST=$(jq -r '.ssh_dest // empty' <<< "$VM_JSON" 2>/dev/null || true)
  PROXY_PORT=$(jq -r '.proxy_port // empty' <<< "$VM_JSON" 2>/dev/null || true)
fi
# Fall back to predictable defaults
[[ -z "$VM_HOST" ]] && VM_HOST="${VM_NAME}.exe.xyz"
[[ -z "$PROXY_PORT" ]] && PROXY_PORT="8000"
diag "Resolved hostname: ${VM_HOST}"
diag "Proxy port: ${PROXY_PORT}"
echo ""

# ── Pre-resolve git server hostname ───────────────────────────────────────────
# The new VM may not be able to resolve primordia.exe.xyz from within the
# exe.dev network.  Resolve the IP here (on the local machine, which can reach
# it) and inject it into the remote VM's /etc/hosts.

_CURRENT_STEP="resolve git server hostname"
PRIMORDIA_GIT_HOST="primordia.exe.xyz"
PRIMORDIA_GIT_IP=""
if command -v python3 &>/dev/null; then
  PRIMORDIA_GIT_IP=$(python3 -c "import socket; print(socket.gethostbyname('${PRIMORDIA_GIT_HOST}'))" 2>/dev/null || true)
fi
if [[ -z "$PRIMORDIA_GIT_IP" ]] && command -v dig &>/dev/null; then
  PRIMORDIA_GIT_IP=$(dig +short "${PRIMORDIA_GIT_HOST}" 2>/dev/null \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
fi
if [[ -z "$PRIMORDIA_GIT_IP" ]]; then
  PRIMORDIA_GIT_IP=$(getent hosts "${PRIMORDIA_GIT_HOST}" 2>/dev/null \
    | awk '{print $1}' | head -1 || true)
fi
if [[ -n "$PRIMORDIA_GIT_IP" ]]; then
  diag "Resolved ${PRIMORDIA_GIT_HOST} → ${PRIMORDIA_GIT_IP} (will inject into remote /etc/hosts)"
else
  diag "Warning: could not pre-resolve ${PRIMORDIA_GIT_HOST} — will attempt DNS on remote VM"
fi

# ── Install Primordia on the VM ───────────────────────────────────────────────

_CURRENT_STEP="install Primordia on VM"
info "Installing Primordia on ${VM_HOST} (this may take a few minutes)..."
diag "SSHing into ${VM_HOST} to run remote setup..."
echo ""

# We use a two-step approach to avoid a stdin-consumption bug:
#
#   Problem: `ssh -tt host bash -s << 'HEREDOC'` feeds the heredoc via the
#   remote PTY's stdin.  Any subprocess inside the script (e.g. apt-get) that
#   reads fd 0 will consume part of the heredoc, truncating the script mid-run.
#   This caused `sudo apt-get install -y locales` to eat the rest of the remote
#   setup script, leaving the user at a live SSH prompt.
#
#   Fix:
#     Step 1 — upload the script to a temp file on the VM (no PTY, heredoc is
#               cleanly consumed by `cat > file` and nothing else can grab it).
#     Step 2 — execute the file with -tt (PTY for live output streaming).
#               bash reads from the file; subprocesses inherit a clean PTY stdin
#               (the user's forwarded terminal), not the script content.
#
# $1 = PRIMORDIA_GIT_HOST, $2 = PRIMORDIA_GIT_IP (may be empty)

ssh -o StrictHostKeyChecking=accept-new "${VM_HOST}" \
  'cat > /tmp/primordia_setup.sh' << 'REMOTE'
# Positional args passed from local machine:
PRIMORDIA_GIT_HOST="${1:-primordia.exe.xyz}"
PRIMORDIA_GIT_IP="${2:-}"
REVERSE_PROXY_PORT="${3:-8000}"

set -euo pipefail

# ── Set locale early to avoid garbled box-drawing characters ───────────────────
# Install and generate the locale BEFORE exporting it so bash doesn't warn
# "cannot change locale (en_US.UTF-8)" (locale must exist first).
export DEBIAN_FRONTEND=noninteractive
sudo apt-get install -y locales </dev/null >/dev/null 2>&1 || true
sudo locale-gen en_US.UTF-8 </dev/null >/dev/null 2>&1 || true
sudo update-locale LANG=en_US.UTF-8 </dev/null >/dev/null 2>&1 || true
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
export LANGUAGE=en_US.UTF-8

GREEN="\033[0;32m"; CYAN="\033[0;36m"; RED="\033[0;31m"; DIM="\033[2m"; BOLD="\033[1m"; RESET="\033[0m"
info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
diag()    { echo -e "${DIM}  $*${RESET}"; }
warn_msg(){ echo -e "\033[0;33m⚠${RESET} $*"; }

_REMOTE_STEP="(initialising)"
trap 'echo -e "\n${RED}✗ Remote setup failed${RESET} at step: ${BOLD}${_REMOTE_STEP}${RESET} (line ${LINENO})" >&2' ERR

# ── Remote diagnostics ─────────────────────────────────────────────────────────
_REMOTE_STEP="remote diagnostics"
diag "--- Remote host diagnostics ---"
diag "Hostname:  $(hostname -f 2>/dev/null || hostname)"
diag "OS:        $(uname -srm)"
diag "User:      $(whoami)"
diag "Disk:      $(df -h / 2>/dev/null | awk 'NR==2{print $4" free of "$2}' || echo 'unknown')"
diag "Memory:    $(free -h 2>/dev/null | awk '/^Mem:/{print $7" free of "$2}' || echo 'unknown')"
diag "resolv.conf: $(grep -v '^#' /etc/resolv.conf 2>/dev/null | tr '\n' ' ' || echo 'missing')"
diag "DNS scopes: $(resolvectl status 2>/dev/null | grep 'Current Scopes' | head -3 | tr '\n' ' ' || echo 'n/a')"
diag "--------------------------------"
echo ""

# ── Wait for DNS ──────────────────────────────────────────────────────────────
# Fresh VMs have a known race condition where systemd-resolved starts before
# the network interface is fully ready, leaving DNS broken for 30-120 seconds.
# We detect this early and actively fix it before attempting any network I/O.
_REMOTE_STEP="wait for DNS"
_dns_ready() { getent hosts registry.npmjs.org >/dev/null 2>&1; }

if ! _dns_ready; then
  info "DNS not ready yet — attempting to fix..."
  diag "resolv.conf: $(grep -v '^#' /etc/resolv.conf 2>/dev/null | tr '\n' ' ' || echo 'missing')"
  diag "DNS scopes:  $(resolvectl status 2>/dev/null | grep 'Current Scopes' | head -5 | tr '\n' ' ' || echo 'n/a')"

  # Fix 1: flush stale cache entries
  sudo resolvectl flush-caches 2>/dev/null || true

  # Fix 2: if /etc/resolv.conf doesn't point to the stub resolver, restore it
  if ! grep -q "127.0.0.53" /etc/resolv.conf 2>/dev/null; then
    diag "Restoring /etc/resolv.conf symlink to stub resolver..."
    sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf 2>/dev/null || true
  fi

  # Fix 3: if systemd-resolved reports no scopes, the NIC wasn't ready when it
  # started (a known systemd-257 race) — restart networkd then resolved.
  if resolvectl status 2>/dev/null | grep -q "Current Scopes: none"; then
    diag "Restarting systemd-networkd + systemd-resolved (NIC was not ready at boot)..."
    sudo systemctl restart systemd-networkd 2>/dev/null || true
    sleep 3
    sudo systemctl restart systemd-resolved 2>/dev/null || true
    sleep 2
  fi

  # Wait up to 60 s for DNS to become available
  _dns_ok=false
  printf "${CYAN}▸${RESET} Waiting for DNS"
  for _i in $(seq 1 30); do
    if _dns_ready; then
      _dns_ok=true
      break
    fi
    printf "."
    sleep 2
  done
  echo ""

  if [[ "$_dns_ok" != "true" ]]; then
    # Last resort: bypass systemd-resolved entirely and write public DNS directly
    warn_msg "DNS still broken after 60 s — falling back to public DNS (1.1.1.1 / 8.8.8.8)"
    diag "resolv.conf was: $(cat /etc/resolv.conf 2>/dev/null | tr '\n' ' ' || echo 'missing')"
    echo -e "nameserver 1.1.1.1\nnameserver 8.8.8.8" | sudo tee /etc/resolv.conf >/dev/null
    sleep 1
    if ! _dns_ready; then
      diag "ping 1.1.1.1: $(ping -c 1 -W 3 1.1.1.1 2>&1 | tail -1 || echo 'failed')"
      echo -e "${RED}✗ DNS resolution failed even with public DNS — cannot continue${RESET}" >&2
      exit 1
    fi
    diag "Public DNS fallback is working"
  fi
fi
success "DNS is ready ($(resolvectl status 2>/dev/null | grep -m1 'DNS Servers' | sed 's/.*DNS Servers: //' || echo 'resolver ok'))"
echo ""

# ── Install git ────────────────────────────────────────────────────────────────
_REMOTE_STEP="install git"
if ! command -v git &>/dev/null; then
  info "Installing git..."
  sudo apt-get update -qq </dev/null && \
    sudo apt-get install -y git curl </dev/null
fi
success "git $(git --version | awk '{print $3}')"

# ── Install bun ────────────────────────────────────────────────────────────────
_REMOTE_STEP="install bun"
export PATH="$HOME/.bun/bin:$PATH"
if ! command -v bun &>/dev/null; then
  info "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
success "bun $(bun --version)"

git config --global user.name  "Primordia" 2>/dev/null || true
git config --global user.email "primordia@localhost" 2>/dev/null || true

echo ""

# ── Ensure git server hostname is resolvable ───────────────────────────────────
_REMOTE_STEP="ensure git host resolvable"
if [[ -n "$PRIMORDIA_GIT_IP" ]]; then
  if ! getent hosts "$PRIMORDIA_GIT_HOST" &>/dev/null; then
    diag "Adding ${PRIMORDIA_GIT_HOST} → ${PRIMORDIA_GIT_IP} to /etc/hosts..."
    echo "${PRIMORDIA_GIT_IP} ${PRIMORDIA_GIT_HOST}" | sudo tee -a /etc/hosts >/dev/null
    diag "DNS injected via /etc/hosts"
  fi
fi

# ── Clone Primordia ────────────────────────────────────────────────────────────
_REMOTE_STEP="clone Primordia"
if [[ -d "$HOME/primordia/.git" ]]; then
  info "Primordia already present — pulling latest changes..."
  git -C "$HOME/primordia" pull
else
  info "Cloning Primordia..."
  git clone https://primordia.exe.xyz/api/git "$HOME/primordia"
fi
success "Primordia cloned to ~/primordia"

echo ""

# ── Run the install script (no API key prompts — check_keys handles that) ──────
_REMOTE_STEP="run install.sh"
cd "$HOME/primordia"
REVERSE_PROXY_PORT="$REVERSE_PROXY_PORT" bash scripts/install.sh
REMOTE

# Step 2: execute the uploaded script with a PTY for live streaming output.
# bash reads from the file — subprocesses get a clean PTY stdin (the forwarded
# local terminal), not the script content.
ssh -tt -o StrictHostKeyChecking=accept-new "${VM_HOST}" \
  "bash /tmp/primordia_setup.sh '${PRIMORDIA_GIT_HOST}' '${PRIMORDIA_GIT_IP:-}' '${PROXY_PORT}'; rm -f /tmp/primordia_setup.sh"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${GREEN}  Primordia is running!${RESET}"
echo ""
echo -e "  Access (requires sign-in):  ${BOLD}https://${VM_HOST}:${PROXY_PORT}/${RESET}"
echo ""
echo -e "  To make it publicly accessible, run:"
echo -e "    ${DIM}ssh exe.dev share set-public ${VM_NAME}${RESET}"
echo ""
echo -e "  Sign in with your exe.dev account. Any missing configuration"
echo -e "  (API keys etc.) will be requested on first login."
echo ""
