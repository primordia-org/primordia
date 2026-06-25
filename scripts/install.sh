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

set -eEuo pipefail
export DEBIAN_FRONTEND=noninteractive

# ── Colours / formatting ──────────────────────────────────────────────────────
# Happy-path progress messages (info/success/warn/_step/_done) should be short
# and free of variable-length strings (branch names, paths, etc.) so the
# output looks good on narrow screens and mobile devices. Error and diagnostic
# messages (die/diag and the ERR trap) may include full detail.

if [[ "${REPORT_STYLE:-}" == "plain" ]]; then
  BOLD="" GREEN="" CYAN="" YELLOW="" RED="" DIM="" RESET=""
elif [[ "${REPORT_STYLE:-}" == "ansi" ]] || [[ -t 1 ]] || [[ -e /dev/tty ]]; then
  BOLD="\033[1m"; GREEN="\033[0;32m"; CYAN="\033[0;36m"
  YELLOW="\033[0;33m"; RED="\033[0;31m"; DIM="\033[2m"; RESET="\033[0m"
else
  BOLD="" GREEN="" CYAN="" YELLOW="" RED="" DIM="" RESET=""
fi

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
diag()    { echo -e "${DIM}  $*${RESET}"; }

socket_status_hint_for_log() {
  local log_file="$1"
  if grep -Eiq 'socket(\.dev|security)?' "$log_file" && grep -Eiq '\b503\b|service unavailable|temporar(y|ily) unavailable|bad gateway|gateway timeout' "$log_file"; then
    echo -e "${YELLOW}⚠${RESET} Socket.dev's package scanner appears to be temporarily unavailable. Check Socket.dev status: https://status.socket.dev/" >&2
    echo -e "${YELLOW}⚠${RESET} Primordia prioritizes your server's safety, so the best course of action is try again or wait until the security scanner is available again." >&2
  fi
}

# _step: print a spinner line (no newline) — replaced by _done on success
# _done: stop the spinner and overwrite the line with ✓
# _spin_kill: stop spinner without printing a success line (use before die)
# REPORT_STYLE=plain: suppress _step and spinner; _done prints directly (useful
# when stdout is not a tty, e.g. piped through another process).
_SPINNER_PID=""
_step() {
  [[ "${REPORT_STYLE:-}" == "plain" ]] && return
  local msg="$*"
  printf '\\ %s' "$msg"
  ( local i=1; local c='\|/-'
    while true; do sleep 0.12; printf '\r%s %s' "${c:$((i % 4)):1}" "$msg"; i=$((i+1)); done ) &
  _SPINNER_PID=$!
  disown "$_SPINNER_PID" 2>/dev/null || true
}
_done() {
  if [[ "${REPORT_STYLE:-}" == "plain" ]]; then
    printf "${GREEN}✓${RESET} %s\n" "$*"
    return
  fi
  if [[ -n "${_SPINNER_PID:-}" ]]; then
    kill "$_SPINNER_PID" 2>/dev/null || true; wait "$_SPINNER_PID" 2>/dev/null || true; _SPINNER_PID=""
  fi
  printf "\r\033[K${GREEN}✓${RESET} %s\n" "$*"
}
_spin_kill() {
  [[ "${REPORT_STYLE:-}" == "plain" ]] && return
  if [[ -n "${_SPINNER_PID:-}" ]]; then
    kill "$_SPINNER_PID" 2>/dev/null || true; wait "$_SPINNER_PID" 2>/dev/null || true; _SPINNER_PID=""
  fi
  printf "\r\033[K"
}

server_diagnostics() {
  diag "--- Server diagnostics ---------------------------------------"
  diag "Date:      $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  diag "Hostname:  $(hostname -f 2>/dev/null || hostname)"
  diag "OS:        $(uname -srm)"
  if [[ -f /etc/os-release ]]; then
    diag "Distro:    $(. /etc/os-release && echo "${PRETTY_NAME:-$ID}")"
  fi
  diag "User:      $(whoami)"
  diag "Disk:      $(df -h "." 2>/dev/null | awk 'NR==2{print $4" free of "$2}' || echo 'unknown')"
  diag "Memory:    $(free -h 2>/dev/null | awk '/^Mem:/{print $7" free of "$2}' || echo 'unknown')"
  diag "--------------------------------------------------------------"
  echo ""
}

# ── Failure reporting ─────────────────────────────────────────────────────────

_CURRENT_STEP="(initialising)"
_INSTALL_FAILURE_REPORTED=false
_LAST_FAILURE_LINE=""
_LAST_FAILURE_COMMAND=""

report_install_failure() {
  local exit_code="$1"
  local line="${2:-unknown}"
  local command="${3:-unknown}"

  if [[ "${_INSTALL_FAILURE_REPORTED}" == "true" ]]; then
    return
  fi
  _INSTALL_FAILURE_REPORTED=true

  _spin_kill
  echo -e "\n${RED}✗ Install failed${RESET} at step: ${BOLD}${_CURRENT_STEP}${RESET} (line ${line}, exit ${exit_code})" >&2
  echo -e "${DIM}  Failed command: ${command}${RESET}" >&2
  server_diagnostics >&2
  echo "" >&2
  echo -e "${DIM}  Service logs (last 30 lines):${RESET}" >&2
  journalctl -u primordia -n 30 --no-pager 2>/dev/null >&2 || true
  echo "" >&2
  echo -e "${DIM}  Service status:${RESET}" >&2
  systemctl status primordia --no-pager 2>/dev/null >&2 || true
}

die() {
  echo -e "${RED}✗ $*${RESET}" >&2
  _LAST_FAILURE_LINE="${BASH_LINENO[0]:-${LINENO}}"
  _LAST_FAILURE_COMMAND="die: $*"
  report_install_failure 1 "$_LAST_FAILURE_LINE" "$_LAST_FAILURE_COMMAND"
  exit 1
}

exit_with_failure() {
  local exit_code="${1:-1}"
  local line="${2:-${BASH_LINENO[0]:-${LINENO}}}"
  local command="${3:-explicit exit ${exit_code}}"
  _LAST_FAILURE_LINE="$line"
  _LAST_FAILURE_COMMAND="$command"
  report_install_failure "$exit_code" "$_LAST_FAILURE_LINE" "$_LAST_FAILURE_COMMAND"
  exit "$exit_code"
}

trap '_exit_code=$?; _failed_line="${BASH_LINENO[0]:-${LINENO}}"; _failed_command="${BASH_COMMAND:-unknown}"; report_install_failure "$_exit_code" "$_failed_line" "$_failed_command"' ERR

# ── Banner ────────────────────────────────────────────────────────────────────
# Show only on initial install (git unavailable = fresh machine, or the current
# working directory is not a git repo = first run OR running over SSH, or
# primordia.productionBranch not yet set = first run).
if ! command -v git &>/dev/null || ! git config --get primordia.productionBranch &>/dev/null 2>&1; then
  echo ""
  cat << 'ASCII'
  ___     _                  _ _
 | _ \_ _(_)_ __  ___ _ _ __| (_)__ _
 |  _/ '_| | '  \/ _ \ '_/ _` | / _` |
 |_| |_| |_|_|_|_\___/_| \__,_|_\__,_|

          . _  __|_ _ || _  _
          || |_\ | (_|||(/_|

ASCII
fi

# ── Install git ───────────────────────────────────────────────────────────────

_CURRENT_STEP="ensure git is available"
if ! command -v git &>/dev/null; then
  _step "Installing git..."
  sudo apt-get update -qq </dev/null >/dev/null 2>&1
  sudo apt-get install -y git </dev/null >/dev/null 2>&1
  _done "Installed git $(git --version | awk '{print $3}')"
else
  success "Using git $(git --version | awk '{print $3}')"
fi

# ── Locate directories ────────────────────────────────────────────────────────

_CURRENT_STEP="Locate directories"
SCRIPT_DIR=""
THIS_FILE="${BASH_SOURCE[0]:-}"
if [[ "${THIS_FILE}" != "bash" && "${THIS_FILE}" != "-bash" && -n "${THIS_FILE}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${THIS_FILE}")" && pwd)"
fi

IS_WORKTREE_INSTALL=false
if [[ -n "$SCRIPT_DIR" ]] && git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
  IS_WORKTREE_INSTALL=true
  WORKTREES_DIR="$(dirname "$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)")"
  PRIMORDIA_DIR="$(dirname "${WORKTREES_DIR}")"
  if [[ -z "${1:-}" ]]; then
    BRANCH="$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD)"
  else
    BRANCH="$1"
    if [[ "$BRANCH" != "$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD)" ]]; then
      die "Error: branch argument '$BRANCH' does not match worktree branch"
    fi
  fi
  success "Using ${PRIMORDIA_DIR}"
else
  PRIMORDIA_DIR="$(pwd)/primordia"
  WORKTREES_DIR="${PRIMORDIA_DIR}/worktrees"
  mkdir -p "$WORKTREES_DIR"
  success "Created ${PRIMORDIA_DIR}"
fi

BARE_REPO="${PRIMORDIA_DIR}/source.git"

# When this script is served by a Primordia instance's /install.sh route, that
# route rewrites this default to its own public URL. New installs persist it in
# the service environment so the child can register itself with its parent after
# the first public request establishes its canonical URL.
PRIMORDIA_PARENT_URL_DEFAULT=""
PRIMORDIA_PARENT_URL="${PRIMORDIA_PARENT_URL:-${PRIMORDIA_PARENT_URL_DEFAULT}}"

# ── Clone Primordia ───────────────────────────────────────────────────────────

_CURRENT_STEP="Clone primordia"
if [[ ! -d "${BARE_REPO}" ]]; then
  _step "Cloning Primordia..."
  _log=$(mktemp)
  if ! git clone --bare https://primordia.exe.xyz/api/git "${BARE_REPO}" >"$_log" 2>&1; then _spin_kill; cat "$_log" >&2; rm -f "$_log"; exit_with_failure 1 "$LINENO" "git clone --bare https://primordia.exe.xyz/api/git ${BARE_REPO}"; fi
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
# Skip if it was already calculated in the 'Locate directories' step
if [[ -z "${BRANCH:-}" ]]; then
  if [[ -n "${1:-}" ]]; then
    # Branch name provided to installer
    BRANCH="$1"
  else
    # Find the remote branch that points to the same commit as origin/main
    BRANCH="$(git -C "${BARE_REPO}" branch --format '%(refname:short)' --points-at "$(git -C "${BARE_REPO}" rev-parse main)" | grep -v 'main' | head -1 || true)"
  fi
fi

# Confirm such a branch exists
if ! git -C "${BARE_REPO}" show-ref --quiet "$BRANCH"; then
  die "Branch not found: ${BRANCH}"
fi

success "Branch: ${BRANCH}"

# ── Create worktree ───────────────────────────────────────────────────────────

_CURRENT_STEP="Create worktree"
INSTALL_DIR="${WORKTREES_DIR}/${BRANCH}"
if [[ -d "${INSTALL_DIR}" ]]; then
  success "Using existing worktree"
else
  _step "Creating worktree..."
  # Create a local tracking branch from the remote ref and check it out in
  # the new worktree.
  _log=$(mktemp)
  if ! git -C "${BARE_REPO}" worktree add "${INSTALL_DIR}" "${BRANCH}" >"$_log" 2>&1; then _spin_kill; cat "$_log" >&2; rm -f "$_log"; exit_with_failure 1 "$LINENO" "git worktree add ${INSTALL_DIR} ${BRANCH}"; fi
  rm -f "$_log"
  _done "Worktree created"
fi

# ── Install git hooks ─────────────────────────────────────────────────────────

_CURRENT_STEP="install git hooks"
GIT_HOOKS_SRC="${INSTALL_DIR}/scripts/git-hooks"
GIT_HOOKS_DST="${BARE_REPO}/hooks"

install_git_hook() {
  local hook_name="$1"
  local src="${GIT_HOOKS_SRC}/${hook_name}"
  local dst="${GIT_HOOKS_DST}/${hook_name}"
  local tmp="${dst}.tmp.$$"

  [[ -f "$src" ]] || die "Missing git hook source: ${src}"
  install -m 0755 "$src" "$tmp"
  mv "$tmp" "$dst"
}

mkdir -p "${GIT_HOOKS_DST}"
if [[ ! -f "${GIT_HOOKS_DST}/reference-transaction" ]] || ! diff -q "${GIT_HOOKS_SRC}/reference-transaction" "${GIT_HOOKS_DST}/reference-transaction" >/dev/null 2>&1; then
  _step "Installing git hooks..."
  install_git_hook "reference-transaction"
  _done "Installed git hooks"
else
  success "Using git hooks"
fi
git -C "${BARE_REPO}" config receive.denyCurrentBranch ignore
git -C "${BARE_REPO}" config receive.denyDeleteCurrent refuse

# ── Install mise + Bun ────────────────────────────────────────────────────────

_CURRENT_STEP="install mise"
MISE_BIN="${HOME}/.local/bin/mise"
MISE_SHIMS_DIR="${HOME}/.local/share/mise/shims"

MISE_WAS_INSTALLED=false
if [[ ! -x "${MISE_BIN}" ]] && ! command -v mise &>/dev/null; then
  _step "Installing mise..."
  _mise_install_log=$(mktemp)
  if ! curl -fsSL https://mise.run | sh >"$_mise_install_log" 2>&1; then
    cat "$_mise_install_log" >&2
    rm -f "$_mise_install_log"
    die "mise installation failed"
  fi
  rm -f "$_mise_install_log"
  MISE_WAS_INSTALLED=true
fi

if [[ ! -x "${MISE_BIN}" ]]; then
  MISE_BIN="$(command -v mise || true)"
fi
[[ -n "${MISE_BIN}" && -x "${MISE_BIN}" ]] || die "mise installation failed"

export PATH="$(dirname "${MISE_BIN}"):${MISE_SHIMS_DIR}:${PATH}"
export MISE_TRUSTED_CONFIG_PATHS="${PRIMORDIA_DIR}:${WORKTREES_DIR}${MISE_TRUSTED_CONFIG_PATHS:+:${MISE_TRUSTED_CONFIG_PATHS}}"

mise_version_output() {
  "${MISE_BIN}" --version 2>&1
}

mise_display_version() {
  local output="$1"
  local version_line=""
  version_line="$(printf '%s\n' "$output" | awk '/^[0-9]+\.[0-9]+\.[0-9]+/ { print; exit }')"
  if [[ -n "$version_line" ]]; then
    printf '%s' "$version_line"
  else
    printf '%s' "$output" | head -n 1
  fi
}

_mise_version_output="$(mise_version_output)"
if [[ "${MISE_WAS_INSTALLED}" == "true" ]]; then
  _done "Installed mise $(mise_display_version "$_mise_version_output")"
fi

if printf '%s\n' "$_mise_version_output" | grep -Eq 'mise version .+ available|To update, run mise self-update'; then
  _CURRENT_STEP="update mise"
  _step "Updating mise..."
  _mise_update_log=$(mktemp)
  if ! "${MISE_BIN}" self-update --yes >"$_mise_update_log" 2>&1; then
    _spin_kill
    cat "$_mise_update_log" >&2
    rm -f "$_mise_update_log"
    die "mise self-update failed"
  fi
  rm -f "$_mise_update_log"
  hash -r
  _mise_version_output="$(mise_version_output)"
  _done "Updated mise $(mise_display_version "$_mise_version_output")"
elif [[ "${MISE_WAS_INSTALLED}" != "true" ]]; then
  success "Using mise $(mise_display_version "$_mise_version_output")"
fi

_CURRENT_STEP="configure bash for mise"
BASHRC="${HOME}/.bashrc"
MISE_BASH_MARKER="# Primordia mise activation"
if [[ -f "${BASHRC}" ]] && grep -Fq "${MISE_BASH_MARKER}" "${BASHRC}"; then
  success "Using bash mise integration"
else
  {
    echo ""
    echo "${MISE_BASH_MARKER}"
    echo "if [ -x \"${MISE_BIN}\" ]; then"
    echo "  eval \"\$(${MISE_BIN} activate bash)\""
    echo 'fi'
  } >> "${BASHRC}"
  success "Installed bash mise integration"
fi

_CURRENT_STEP="install tools with mise"
cd "${INSTALL_DIR}"
[[ -f "${INSTALL_DIR}/mise.toml" ]] || die "Missing mise.toml"
"${MISE_BIN}" trust "${INSTALL_DIR}/mise.toml" >/dev/null 2>&1 || true
_step "Installing mise tools..."
_bun_install_log=$(mktemp)
if ! "${MISE_BIN}" install >"$_bun_install_log" 2>&1; then
  cat "$_bun_install_log" >&2
  rm -f "$_bun_install_log"
  die "mise tool installation failed"
fi
"${MISE_BIN}" reshim >/dev/null 2>&1 || true
rm -f "$_bun_install_log"
_done "Using bun $(bun --version)"

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
  socket_status_hint_for_log "$_bun_log"
  rm -f "$_bun_log"; exit_with_failure 1 "$LINENO" "bun install --frozen-lockfile"
fi
rm -f "$_bun_log"
_done "Installed dependencies"

# ── Typecheck (worktree installs only) ───────────────────────────────────────
# Run the typechecker before the production build so type errors are caught
# early and reported clearly, without waiting for a full Next.js build.
# Skipped on first-time installs because there is no existing production slot
# to compare against and the build already surfaces type errors.

if [[ "${IS_WORKTREE_INSTALL}" == "true" ]]; then
  _CURRENT_STEP="bun run typecheck"
  _step "bun run typecheck..."
  _typecheck_log=$(mktemp)
  if ! bun run typecheck > "$_typecheck_log" 2>&1; then
    _spin_kill  # stop spinner so its pipe-holding sub-process exits before we do
    printf "\n"
    echo -e "${DIM}  --- typecheck output ---${RESET}" >&2
    cat "$_typecheck_log" >&2
    echo -e "${DIM}  ------------------------${RESET}" >&2
    # Write raw errors to a well-known path so the accept endpoint can read
    # them and pass them to the auto-fix Claude session.
    cp "$_typecheck_log" "${INSTALL_DIR}/.primordia-typecheck-errors.txt"
    rm -f "$_typecheck_log"
    exit 2  # exit 2 = typecheck failure; exit 1 = any other failure
  fi
  rm -f "$_typecheck_log"
  _done "Typecheck passed"
fi

# ── Build production bundle ───────────────────────────────────────────────────

_CURRENT_STEP="bun run build"
_step "bun run build..."
_build_log=$(mktemp)
if ! bun run build > "$_build_log" 2>&1; then
  _spin_kill  # stop spinner so its pipe-holding sub-process exits before we do
  printf "\n"
  echo -e "${DIM}  --- build output ---${RESET}" >&2
  cat "$_build_log" >&2
  echo -e "${DIM}  --------------------${RESET}" >&2
  rm -f "$_build_log"; exit_with_failure 1 "$LINENO" "bun run build"
fi
rm -f "$_build_log"
_done "Build complete"

# ── Install reverse-proxy ─────────────────────────────────────────────────────

_CURRENT_STEP="bundle reverse proxy"
REVERSE_PROXY_SOURCE="${INSTALL_DIR}/scripts/reverse-proxy.ts"
REVERSE_PROXY_BUNDLE_DIR="$(mktemp -d)"
REVERSE_PROXY_BUNDLE="${REVERSE_PROXY_BUNDLE_DIR}/reverse-proxy.js"
REVERSE_PROXY_DEST="${PRIMORDIA_DIR}/reverse-proxy.js"
MISE_CONFIG_SOURCE="${INSTALL_DIR}/mise.toml"
MISE_CONFIG_DEST="${PRIMORDIA_DIR}/mise.toml"
ROOT_MISE_CHANGED=false

_step "Bundling reverse proxy..."
_proxy_bundle_log=$(mktemp)
if ! bun build "${REVERSE_PROXY_SOURCE}" --target=bun --outfile="${REVERSE_PROXY_BUNDLE}" >"$_proxy_bundle_log" 2>&1; then
  _spin_kill
  printf "\n"
  echo -e "${DIM}  --- reverse proxy bundle output ---${RESET}" >&2
  cat "$_proxy_bundle_log" >&2
  echo -e "${DIM}  -----------------------------------${RESET}" >&2
  rm -f "$_proxy_bundle_log"
  rm -rf "${REVERSE_PROXY_BUNDLE_DIR}"
  exit_with_failure 1 "$LINENO" "bun build ${REVERSE_PROXY_SOURCE} --target=bun --outfile=${REVERSE_PROXY_BUNDLE}"
fi
rm -f "$_proxy_bundle_log"
_done "Bundled reverse proxy"

_CURRENT_STEP="install reverse proxy"
# Calculate if the proxy bundle needs updating
if [[ ! -f "${REVERSE_PROXY_DEST}" ]]; then
  PROXY_CHANGED=true
elif ! diff -q "${REVERSE_PROXY_BUNDLE}" "${REVERSE_PROXY_DEST}" >/dev/null 2>&1; then
  PROXY_CHANGED=true
else
  PROXY_CHANGED=false
fi

if [[ "${PROXY_CHANGED}" == "true" ]]; then
  cp -f "${REVERSE_PROXY_BUNDLE}" "${REVERSE_PROXY_DEST}"
  rm -f "${PRIMORDIA_DIR}/reverse-proxy.ts"
  success "Installed reverse-proxy.js"
else
  success "Using reverse-proxy.js"
fi
rm -rf "${REVERSE_PROXY_BUNDLE_DIR}"

if [[ ! -f "${MISE_CONFIG_DEST}" ]] || ! diff -q "${MISE_CONFIG_SOURCE}" "${MISE_CONFIG_DEST}" >/dev/null 2>&1; then
  cp -f "${MISE_CONFIG_SOURCE}" "${MISE_CONFIG_DEST}"
  "${MISE_BIN}" trust "${MISE_CONFIG_DEST}" >/dev/null 2>&1 || true
  ROOT_MISE_CHANGED=true
  success "Installed mise.toml"
else
  success "Using mise.toml"
fi

# ── Determine hostname ────────────────────────────────────────────────────────

_CURRENT_STEP="determine hostname"
HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
REVERSE_PROXY_PORT=3000

if [[ "$HOSTNAME_FQDN" == *.local || "$HOSTNAME_FQDN" == *.lan || "$HOSTNAME_FQDN" == "localhost" ]]; then
  info "No domain name detected. Assuming localhost."
  APP_URL="http://localhost:${REVERSE_PROXY_PORT}"
  PROBABLY_A_SERVER=false
elif [[ "$HOSTNAME_FQDN" == *.exe.xyz ]]; then
  success "Detected exe.xyz host"
  APP_URL="https://${HOSTNAME_FQDN}"
  PROBABLY_A_SERVER=true
  REVERSE_PROXY_PORT=8000
else
  warn "Not running on exe.dev — automatic SSL termination, exe.dev login, and LLM gateway integration won't be available."
  APP_URL="http://${HOSTNAME_FQDN}:${REVERSE_PROXY_PORT}"
  PROBABLY_A_SERVER=true
fi

# ── Install systemd service ───────────────────────────────────────────────────
# Always installs/updates the service unit file and enables it on boot.
# Whether we restart the proxy depends on the zero-downtime check below.

_CURRENT_STEP="install systemd service"
SERVICE_CHANGED=false

if [[ "${PROBABLY_A_SERVER}" == "true" ]] && command -v systemctl &>/dev/null; then
  success "Detected systemd v$(systemctl --version | awk 'NR==1 {print $2}')"
  _step "Installing systemd service..."
  SYSTEMD_SERVICE_DIR="/etc/systemd/system"
  PROXY_SERVICE_DST="${SYSTEMD_SERVICE_DIR}/primordia.service"
  PARENT_URL_ENV_LINE=""
  if [[ -n "${PRIMORDIA_PARENT_URL}" ]]; then
    PARENT_URL_ENV_LINE="Environment=PRIMORDIA_PARENT_URL=${PRIMORDIA_PARENT_URL}"
  fi
  GENERATED_UNIT=$(cat << UNIT
[Unit]
Description=Primordia Reverse Proxy
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${PRIMORDIA_DIR}
Environment=REVERSE_PROXY_PORT=${REVERSE_PROXY_PORT}
Environment=HOME=${HOME}
Environment=PATH=${MISE_SHIMS_DIR}:$(dirname "${MISE_BIN}"):/usr/local/bin:/usr/bin:/bin
Environment=MISE_TRUSTED_CONFIG_PATHS=${PRIMORDIA_DIR}:${WORKTREES_DIR}
${PARENT_URL_ENV_LINE}
ExecStart=${MISE_BIN} exec -C ${PRIMORDIA_DIR} -- bun ${PRIMORDIA_DIR}/reverse-proxy.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
)

  # Calculate if the service unit needs updating
  if [[ ! -f "${PROXY_SERVICE_DST}" ]] || ! diff -q <(echo "$GENERATED_UNIT") "${PROXY_SERVICE_DST}" >/dev/null 2>&1; then
    SERVICE_CHANGED=true
  else
    SERVICE_CHANGED=false
  fi

  # Install/update the service unit
  if [[ "$SERVICE_CHANGED" == "true" ]]; then
    echo "$GENERATED_UNIT" | sudo tee "${PROXY_SERVICE_DST}" >/dev/null
    sudo systemctl daemon-reload
    _done "Installed primordia systemd service"
  else
    _done "Using primordia systemd service"
  fi

  # Enable the service so it starts automatically on boot
  if ! systemctl is-enabled --quiet primordia 2>/dev/null; then
    sudo systemctl enable --quiet primordia 2>/dev/null
    success "Enabled primordia systemd service"
  fi
fi

# ── Zero-downtime cutover (or first-time start) ───────────────────────────────
# If the proxy is already running and neither it nor the service unit changed,
# we can do a zero-downtime slot swap by starting the new server with
# `bun run primordia start --prod --worktree <branch>` and then flipping git config.  This keeps existing connections alive.
#
# If either changed, or the proxy isn't running yet, we fall back to the
# traditional restart/start path (brief downtime, unavoidable).

_CURRENT_STEP="deploy new slot"

PROXY_RUNNING=false
if [[ "${PROBABLY_A_SERVER}" == "true" ]] && command -v systemctl &>/dev/null; then
  if systemctl is-active --quiet primordia 2>/dev/null; then
    PROXY_RUNNING=true
  fi
else
  # Non-server install: detect proxy by checking if it responds on the port.
  if curl -sf --max-time 2 "http://localhost:${REVERSE_PROXY_PORT}/" -o /dev/null 2>/dev/null; then
    PROXY_RUNNING=true
  fi
fi

# Reparent sibling sessions whose legacy git-config parent was the old production
# branch so the old branch-parent source remains usable while branch-marker tracking
# is being tested.
DB_NAME=".primordia-auth.db"
OLD_PROD_BRANCH="$(git -C "${BARE_REPO}" config --get primordia.productionBranch 2>/dev/null || true)"
if [[ -n "$OLD_PROD_BRANCH" && "$OLD_PROD_BRANCH" != "$BRANCH" ]]; then
  while read -r key val; do
    # key looks like: branch.<name>.parent  (space-separated, git config --get-regexp output)
    sibling="${key#branch.}"; sibling="${sibling%.parent}"
    if [[ "$val" == "$OLD_PROD_BRANCH" && "$sibling" != "$BRANCH" ]]; then
      git -C "${BARE_REPO}" config "branch.${sibling}.parent" "$BRANCH" 2>/dev/null || true
    fi
  done < <(git -C "${BARE_REPO}" config --get-regexp 'branch\..*\.parent' 2>/dev/null || true)
fi

# Copy DB from old production slot before activating, so the new slot
# inherits all users/sessions/passkeys.  Mirrors what blueGreenAccept() does.
if [[ -n "$OLD_PROD_BRANCH" && "$OLD_PROD_BRANCH" != "$BRANCH" ]]; then
  OLD_SLOT="$(git -C "${BARE_REPO}" worktree list --porcelain \
    | awk '/^worktree /{p=$2} /^branch refs\/heads\/'"${OLD_PROD_BRANCH}"'$/{print p; exit}' || true)"
  if [[ -n "$OLD_SLOT" && -f "${OLD_SLOT}/${DB_NAME}" ]]; then
    _CURRENT_STEP="copy production DB"
    _step "Copying production DB..."
    NEW_DB="${INSTALL_DIR}/${DB_NAME}"
    rm -f "${NEW_DB}" "${NEW_DB}-wal" "${NEW_DB}-shm"
    sqlite3 "${OLD_SLOT}/${DB_NAME}" "VACUUM INTO '${NEW_DB}'"
    _done "DB copied"
  fi
fi

# Advance the main branch pointer to the now-live commit, then push to the
# mirror remote if one is configured. Non-fatal: a push failure never blocks
# the install — it just prints a warning.
#
# Mirrors the logic in moveMainAndPush() in app/api/evolve/manage/route.ts:
#   - If main is checked out in a worktree, use `git reset --hard` there so
#     the working tree stays consistent with the updated ref.
#   - If main is not checked out anywhere, use `git update-ref` directly
#     (safe when no worktree has it checked out).
advance_main_and_push() {
  _CURRENT_STEP="advance main ref: rev-parse branch"
  local branch_sha
  branch_sha="$(git -C "${BARE_REPO}" rev-parse "$BRANCH")"
  diag "advance_main_and_push: BRANCH=${BRANCH} sha=${branch_sha}"

  # Find the worktree (if any) that has main checked out.
  _CURRENT_STEP="advance main ref: find main worktree"
  local main_worktree=""
  local _wt_path="" _wt_branch=""
  while IFS= read -r line; do
    if [[ "$line" == worktree\ * ]]; then
      _wt_path="${line#worktree }"
      _wt_branch=""
    elif [[ "$line" == branch\ * ]]; then
      _wt_branch="${line#branch refs/heads/}"
    elif [[ -z "$line" && "$_wt_branch" == "main" ]]; then
      main_worktree="$_wt_path"
      break
    fi
  done < <(git -C "${BARE_REPO}" worktree list --porcelain)
  diag "advance_main_and_push: main_worktree=${main_worktree:-<none>}"

  _CURRENT_STEP="advance main ref: reset/update-ref"
  if [[ -n "$main_worktree" ]]; then
    diag "advance_main_and_push: git reset --hard ${branch_sha} in ${main_worktree}"
    git -C "$main_worktree" reset --hard "$branch_sha"
  else
    diag "advance_main_and_push: git update-ref refs/heads/main ${branch_sha}"
    git -C "${BARE_REPO}" update-ref refs/heads/main "$branch_sha"
  fi

  _CURRENT_STEP="advance main ref: push mirror"
  if git -C "${BARE_REPO}" config --get remote.mirror.url &>/dev/null; then
    _mirror_err="$(mktemp)"
    if git -C "${BARE_REPO}" push mirror 2>"$_mirror_err"; then
      success "Mirror remote updated"
    else
      warn "Could not push to mirror remote (non-fatal): $(cat "$_mirror_err" | tail -3)"
    fi
    rm -f "$_mirror_err"
  fi
}

SERVICE_READY=false


# Zero-downtime eligibility:
# - Server install: proxy running + neither proxy script nor service unit changed
# - Non-server (local dev): proxy running (can't auto-restart proxy, so always attempt
#   zero-downtime; if PROXY_CHANGED, warn user to restart proxy manually afterward)
if [[ "${PROXY_RUNNING}" == "true" ]] && \
   { [[ "${PROBABLY_A_SERVER}" == "false" ]] || \
     [[ "${PROXY_CHANGED}" == "false" && "${SERVICE_CHANGED}" == "false" && "${ROOT_MISE_CHANGED}" == "false" ]]; }; then
  # ── Zero-downtime path ────────────────────────────────────────────────────
  # The proxy is running and neither it nor the service unit changed. Start the
  # new production server through the process-manager CLI, health-check it, then
  # flip git config so the proxy routes traffic to the healthy slot.
  _CURRENT_STEP="zero-downtime start: process-manager"
  _step "Deploying to new slot (zero-downtime)..."
  _PROCESS_JSON="$(mktemp)"
  diag "zero-downtime start: bun run primordia start --prod --worktree ${BRANCH}"
  if ${MISE_BIN} exec -C "${INSTALL_DIR}" -- bun run primordia start --prod --json --worktree "${BRANCH}" >"$_PROCESS_JSON" 2>&1; then
    _NEW_PORT="$(grep -o '"port":[[:space:]]*[0-9]*' "$_PROCESS_JSON" | head -1 | grep -o '[0-9]*' || true)"
    if [[ -z "$_NEW_PORT" ]]; then
      warn "Could not determine new server port from process-manager output. Falling back to service restart."
    else
      _CURRENT_STEP="zero-downtime start: health check"
      _done "Server started"
      _step "Health-checking server..."
      _HEALTH_OK=false
      for _i in {1..30}; do
        if curl -sf --max-time 3 "http://localhost:${_NEW_PORT}/" -o /dev/null 2>/dev/null; then
          _HEALTH_OK=true
          break
        fi
        sleep 1
      done
      if [[ "$_HEALTH_OK" == "true" ]]; then
        _done "Health-check passed"
        _CURRENT_STEP="zero-downtime start: activate git config"
        git -C "${BARE_REPO}" config primordia.productionBranch "${BRANCH}" || true
        git -C "${BARE_REPO}" config --add primordia.productionHistory "${BRANCH}" || true
        git -C "${BARE_REPO}" config "branch.${BRANCH}.port" "${_NEW_PORT}" || true
        SERVICE_READY=true
        advance_main_and_push
        if [[ "${PROBABLY_A_SERVER}" == "false" ]] && { [[ "${PROXY_CHANGED}" == "true" ]] || [[ "${ROOT_MISE_CHANGED}" == "true" ]]; }; then
          warn "Proxy runtime files changed — restart the proxy manually to pick up the new version."
        fi
        echo -e "${GREEN}✓${RESET} Congratulations! Primordia is running!"
      else
        _spin_kill
        warn "Zero-downtime deploy failed (new server did not pass health check). Falling back to service restart."
      fi
    fi
  else
    _spin_kill
    warn "Zero-downtime deploy failed ($(cat "$_PROCESS_JSON" | tail -3)). Falling back to service restart."
  fi
  rm -f "$_PROCESS_JSON"
fi

if [[ "${SERVICE_READY}" == "false" ]]; then
  # ── Restart/start path ────────────────────────────────────────────────────
  # Used when: first install, proxy/service changed, or zero-downtime failed.
  # Mark the production branch directly — the proxy will pick it up on start.
  _CURRENT_STEP="set production branch in git config"
  diag "restart path: setting primordia.productionBranch=${BRANCH}"
  git -C "${BARE_REPO}" config primordia.productionBranch "$BRANCH"

  if [[ "${PROBABLY_A_SERVER}" == "true" ]] && command -v systemctl &>/dev/null; then
    if [[ "${PROXY_RUNNING}" == "true" ]]; then
      _CURRENT_STEP="restart systemd service"
      sudo systemctl restart --quiet primordia
      success "Restarted primordia systemd service"
    else
      _CURRENT_STEP="start systemd service"
      sudo systemctl start --quiet primordia
      success "Started primordia systemd service"
    fi

    # Only poll for readiness when we actually started/restarted a managed service.
    _CURRENT_STEP="wait for service to be ready"
    _step "Waiting for Primordia to be ready..."
    for i in $(seq 1 30); do
      sleep 2
      if curl -sf --max-time 3 "http://localhost:${REVERSE_PROXY_PORT}/" -o /dev/null 2>/dev/null; then
        SERVICE_READY=true
        break
      fi
    done

    if [[ "$SERVICE_READY" == "true" ]]; then
      _spin_kill
      advance_main_and_push
      echo -e "${GREEN}✓${RESET} Congratulations! Primordia is running!"
    else
      _spin_kill
      warn "Service did not respond within 60 s — it may still be starting."
      echo ""
      echo -e "${DIM}  --- Last 40 lines of service log ---${RESET}"
      journalctl -u primordia -n 40 --no-pager 2>/dev/null || true
      echo -e "${DIM}  --- Service status ---${RESET}"
      systemctl status primordia --no-pager 2>/dev/null || true
      echo -e "${DIM}  -------------------------------------${RESET}"
    fi
  else
    # Non-server install: proxy not running (or zero-downtime already handled it).
    # Build and git config are updated; nothing to start here.
    _CURRENT_STEP="advance main ref and push mirror (non-server)"
    advance_main_and_push
    echo -e "${GREEN}✓${RESET} Congratulations! Primordia is ready."
    if [[ "${PROXY_RUNNING}" == "false" ]]; then
      info "Proxy not detected — start it with: mise exec -C ${PRIMORDIA_DIR} -- bun ${PRIMORDIA_DIR}/reverse-proxy.js"
    fi
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────

if [[ -z "$OLD_PROD_BRANCH" ]] && [[ "$HOSTNAME_FQDN" == *.exe.xyz ]]; then
  # exe.xyz hosts are private by default — the external URL may not be accessible yet.
  # Print the internal localhost address first so the installer can verify it works
  # before configuring public access.
  success "Serving ${BOLD}http://localhost:${REVERSE_PROXY_PORT}${RESET} (internal)"
  success "Serving ${BOLD}${APP_URL}${RESET} (external)"
  echo -e "  ${DIM}(external URL requires public access to be enabled on the exe.dev dashboard)${RESET}"
else
  success "Serving ${BOLD}${APP_URL}${RESET}"
fi
echo ""
if [[ -z "$OLD_PROD_BRANCH" ]]; then
  if [[ "$HOSTNAME_FQDN" == *.exe.xyz ]]; then
    echo "Sign in with your exe.dev account on the login page."
    echo "The first user to sign in is automatically granted the admin role."
    echo "You will be prompted for additional setup information when required."
  else
    echo "Register a passkey on the login page."
    echo "The first user to register is automatically granted the admin role."
  fi
  echo ""
fi
