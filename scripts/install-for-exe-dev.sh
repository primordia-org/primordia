#!/usr/bin/env bash
# scripts/install-for-exe-dev.sh
# Run on your personal computer to create a new Primordia VM on exe.dev.
#
# Usage:
#   curl -fsSL https://primordia.exe.xyz/install-for-exe-dev.sh | bash

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] || [[ -e /dev/tty ]]; then
  BOLD="\033[1m"; GREEN="\033[0;32m"; CYAN="\033[0;36m"
  YELLOW="\033[0;33m"; RED="\033[0;31m"; DIM="\033[2m"; RESET="\033[0m"
else
  BOLD="" GREEN="" CYAN="" YELLOW="" RED="" DIM="" RESET=""
fi

# _step: print a spinner line (no newline) — replaced by _done on success
# _done: stop the spinner and overwrite the line with ✓
# _spin_kill: stop spinner without printing a success line (use before die)
_SPINNER_PID=""
_step() {
  local msg="$*"
  printf '\\ %s' "$msg"
  ( local i=1; local c='\|/-'
    while true; do sleep 0.12; printf '\r%s %s' "${c:$((i % 4)):1}" "$msg"; i=$((i+1)); done ) &
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
info()    { echo -e "${CYAN}▸${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
die()     { echo -e "\n${RED}✗ $*${RESET}" >&2; exit 1; }

_CURRENT_STEP="(initialising)"
trap 'echo -e "\n${RED}✗ Install failed${RESET} at step: ${BOLD}${_CURRENT_STEP}${RESET} (line ${LINENO})" >&2
echo -e "${DIM}  Re-run with:  bash -x install-for-exe-dev.sh  for verbose output${RESET}" >&2' ERR

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
cat << 'ASCII'
  ___     _                  _ _
 | _ \_ _(_)_ __  ___ _ _ __| (_)__ _
 |  _/ '_| | '  \/ _ \ '_/ _` | / _` |
 |_| |_| |_|_|_|_\___/_| \__,_|_\__,_|

          . _  __|_ _ || _  _
          || |_\ | (_|||(/_|   for exe.dev

ASCII

# ── Check prerequisites ───────────────────────────────────────────────────────

_CURRENT_STEP="check prerequisites"
command -v ssh &>/dev/null || die "ssh is required but not found."

# ── Test exe.dev SSH access ───────────────────────────────────────────────────

_CURRENT_STEP="check exe.dev SSH"
_step "Checking exe.dev SSH access..."
SSH_TEST_OUTPUT=$(ssh -n -o BatchMode=yes -o ConnectTimeout=10 exe.dev help 2>&1) || {
  printf "\n"
  echo -e "${DIM}  ssh output: ${SSH_TEST_OUTPUT}${RESET}" >&2
  die "Cannot connect to exe.dev via SSH.

  Set up SSH access first:
    1. Generate a key:  ssh-keygen -t ed25519
    2. Add it at:       https://exe.dev/settings
    3. Test it:         ssh exe.dev help"
}
_done "Connected to exe.dev"
echo ""
echo "First let's create a VM to install Primordia on:"
echo ""

# ── Prompt for VM name ────────────────────────────────────────────────────────

_CURRENT_STEP="prompt VM name"
VM_NAME="primordia"
if [[ -e /dev/tty ]]; then
  printf "? Choose VM name [primordia]: " >/dev/tty
  read -r _input </dev/tty || true
  VM_NAME="${_input:-primordia}"
fi

# ── Create VM ─────────────────────────────────────────────────────────────────

_CURRENT_STEP="create VM"
_step "Creating VM '${VM_NAME}' on exe.dev..."
VM_JSON=$(ssh -n -o BatchMode=yes exe.dev new "--name=${VM_NAME}" --json 2>&1) || {
  _spin_kill
  echo -e "${DIM}  Raw output:\n${VM_JSON}${RESET}" >&2
  die "Failed to create VM — see raw output above."
}
_done "VM '${VM_NAME}' created"

# ── Parse VM JSON ─────────────────────────────────────────────────────────────

_CURRENT_STEP="parse VM JSON"
VM_HOST="" PROXY_PORT=""
if command -v python3 &>/dev/null; then
  VM_HOST=$(python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('ssh_dest',''))" <<< "$VM_JSON" 2>/dev/null || true)
  PROXY_PORT=$(python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('proxy_port',''))" <<< "$VM_JSON" 2>/dev/null || true)
fi
if [[ -z "$VM_HOST" ]] && command -v jq &>/dev/null; then
  VM_HOST=$(jq -r '.ssh_dest // empty' <<< "$VM_JSON" 2>/dev/null || true)
  PROXY_PORT=$(jq -r '.proxy_port // empty' <<< "$VM_JSON" 2>/dev/null || true)
fi
[[ -z "$VM_HOST" ]]    && VM_HOST="${VM_NAME}.exe.xyz"
[[ -z "$PROXY_PORT" ]] && PROXY_PORT="8000"

# ── Wait for VM SSH ───────────────────────────────────────────────────────────

_CURRENT_STEP="wait for VM SSH"
_SSH_READY=false
_step "Waiting for VM SSH to be ready..."
for _i in $(seq 1 30); do
  if ssh -n -o BatchMode=yes -o ConnectTimeout=5 \
         -o StrictHostKeyChecking=accept-new "${VM_HOST}" exit 0 2>/dev/null; then
    _SSH_READY=true; break
  fi
  sleep 2
done
if [[ "$_SSH_READY" != "true" ]]; then
  _spin_kill
  die "VM SSH did not become ready after 60 s"
fi
_done "VM SSH ready"
echo ""
echo "Next, we'll run a short script to install git and clone the Primordia repo:"
echo ""

# ── Upload bootstrap script ───────────────────────────────────────────────────
# Two-step approach:
# Step 1: upload via `ssh host 'cat > file' << HEREDOC` (no PTY).
#         The heredoc is consumed cleanly by cat; no subprocess races with stdin.
# Step 2: execute via `ssh -n -tt host 'bash file'`.
#         -n prevents the curl pipe's remaining content from flowing into the
#         remote PTY's stdin (which would echo as garbled text).
#         -tt allocates a PTY so output streams live to the local terminal.

_CURRENT_STEP="upload bootstrap"
_step "Uploading ./primordia_setup.sh to ${VM_HOST}..."
ssh -o StrictHostKeyChecking=accept-new "${VM_HOST}" \
  'cat > /tmp/primordia_setup.sh' << 'REMOTE'
REVERSE_PROXY_PORT="${1:-8000}"

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# ── Colors & helpers ──────────────────────────────────────────────────────────
# Define colors first so we can use them for the locale success message.
GREEN="\033[0;32m"; CYAN="\033[0;36m"; RED="\033[0;31m"; BOLD="\033[1m"; RESET="\033[0m"
# All remote output is indented 2 spaces to nest visually under the local steps.
# _step: print spinner line (no newline) — replaced by _done on success
# _done: stop spinner and overwrite line with ✓
_SPINNER_PID=""
_step() {
  local msg="$*"
  printf '  \\ %s' "$msg"
  ( local i=1; local c='\|/-'
    while true; do sleep 0.12; printf '\r  %s %s' "${c:$((i % 4)):1}" "$msg"; i=$((i+1)); done ) &
  _SPINNER_PID=$!
  disown "$_SPINNER_PID" 2>/dev/null || true
}
_done() {
  if [[ -n "${_SPINNER_PID:-}" ]]; then
    kill "$_SPINNER_PID" 2>/dev/null || true; wait "$_SPINNER_PID" 2>/dev/null || true; _SPINNER_PID=""
  fi
  printf "\r\033[K  ${GREEN}✓${RESET} %s\n" "$*"
}
_spin_kill() {
  if [[ -n "${_SPINNER_PID:-}" ]]; then
    kill "$_SPINNER_PID" 2>/dev/null || true; wait "$_SPINNER_PID" 2>/dev/null || true; _SPINNER_PID=""
  fi
  printf "\r\033[K"
}
info()    { echo -e "  ${CYAN}▸${RESET} $*"; }
success() { echo -e "  ${GREEN}✓${RESET} $*"; }

_REMOTE_STEP="(initialising)"
trap 'echo -e "\n${RED}✗ Remote setup failed${RESET} at step: ${BOLD}${_REMOTE_STEP}${RESET} (line ${LINENO})" >&2' ERR

# ── Wait for DNS ──────────────────────────────────────────────────────────────
# Fresh VMs have a race where systemd-resolved starts before the NIC is ready,
# leaving DNS broken for up to 120 s.
_REMOTE_STEP="wait for DNS"
_dns_ready() { getent hosts registry.npmjs.org >/dev/null 2>&1; }
if _dns_ready; then
  success "DNS is ready"
else
  _step "Waiting for DNS resolver..."
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
  _dns_ok=false
  for _i in $(seq 1 30); do
    if _dns_ready; then _dns_ok=true; break; fi
    sleep 2
  done
  if [[ "$_dns_ok" != "true" ]]; then
    printf "\nnameserver 1.1.1.1\nnameserver 8.8.8.8\n" | sudo tee /etc/resolv.conf >/dev/null
    sleep 1
    if ! _dns_ready; then
      _spin_kill
      echo -e "${RED}✗ DNS resolution failed — cannot continue${RESET}" >&2; exit 1
    fi
  fi
  _done "DNS is ready"
fi

# ── Set locale ────────────────────────────────────────────────────────────────
# Ensure a UTF-8 locale is active. New VMs default to C.UTF-8 which is
# sufficient, so skip the apt-get/locale-gen dance when any UTF-8 locale is
# already set (avoids the "setlocale: LC_ALL: cannot change locale" warning
# that occurred when exporting en_US.UTF-8 before it was fully available).
_REMOTE_STEP="set locale"
if locale 2>/dev/null | grep -qi "UTF-8"; then
  _CURRENT_LANG=$(locale 2>/dev/null | grep "^LANG=" | cut -d= -f2 | tr -d '"' || echo "UTF-8")
  success "Locale: ${_CURRENT_LANG:-UTF-8} (UTF-8 already active)"
else
  _step "Setting locale..."
  sudo apt-get install -y locales </dev/null >/dev/null 2>&1 || true
  sudo locale-gen en_US.UTF-8 </dev/null >/dev/null 2>&1 || true
  sudo update-locale LANG=en_US.UTF-8 </dev/null >/dev/null 2>&1 || true
  export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en_US.UTF-8
  _done "Updated locale to en_US.UTF-8"
fi

# ── Install git ───────────────────────────────────────────────────────────────
_REMOTE_STEP="install git"
if ! command -v git &>/dev/null; then
  _step "Installing git..."
  sudo apt-get update -qq </dev/null >/dev/null 2>&1
  sudo apt-get install -y git </dev/null >/dev/null 2>&1
  _done "Using git $(git --version | awk '{print $3}')"
else
  success "Using git $(git --version | awk '{print $3}')"
fi
git config --global user.name  "Primordia" 2>/dev/null || true
git config --global user.email "primordia@localhost" 2>/dev/null || true

# ── Clone Primordia ───────────────────────────────────────────────────────────
_REMOTE_STEP="clone Primordia"
if [[ -d "$HOME/primordia/.git" ]]; then
  _step "Updating ~/primordia..."
  _log=$(mktemp)
  if ! git -C "$HOME/primordia" pull >"$_log" 2>&1; then _spin_kill; cat "$_log" >&2; rm -f "$_log"; exit 1; fi
  rm -f "$_log"
  _done "Updated ~/primordia"
else
  _step "Cloning Primordia..."
  _log=$(mktemp)
  if ! git clone https://primordia.exe.xyz/api/git "$HOME/primordia" >"$_log" 2>&1; then _spin_kill; cat "$_log" >&2; rm -f "$_log"; exit 1; fi
  rm -f "$_log"
  _done "Cloned to ~/primordia"
fi

# ── Run install.sh ────────────────────────────────────────────────────────────
_REMOTE_STEP="run install.sh"
echo ""
echo "Now we install Primordia using its installer:"
echo ""
echo "Running ~/primordia/scripts/install.sh:"
export INSTALL_PREFIX="  "
REVERSE_PROXY_PORT="$REVERSE_PROXY_PORT" bash "$HOME/primordia/scripts/install.sh"
REMOTE

_done "Uploaded ./primordia_setup.sh successfully"

# ── Execute bootstrap with live PTY output ────────────────────────────────────
# -n: keep curl pipe from being fed to remote PTY stdin
# -tt: allocate PTY so the remote output streams live
_CURRENT_STEP="run bootstrap"
echo "Running /tmp/primordia_setup.sh:"
ssh -n -tt -o StrictHostKeyChecking=accept-new "${VM_HOST}" \
  "bash /tmp/primordia_setup.sh '${PROXY_PORT}'"

# Cleanup (separate call so rm exit code can't mask the setup script exit code)
ssh -n -o StrictHostKeyChecking=accept-new "${VM_HOST}" \
  "rm -f /tmp/primordia_setup.sh" 2>/dev/null || true
