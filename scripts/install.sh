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
die()     { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }
diag()    { echo -e "${DIM}  $*${RESET}"; }

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

# ── ERR trap ──────────────────────────────────────────────────────────────────

_CURRENT_STEP="(initialising)"
trap '_exit_code=$?
_spin_kill
echo -e "\n${RED}✗ Install failed${RESET} at step: ${BOLD}${_CURRENT_STEP}${RESET} (line ${LINENO}, exit ${_exit_code})" >&2
server_diagnostics >&2
echo "" >&2
echo -e "${DIM}  Service logs (last 30 lines):${RESET}" >&2
journalctl -u primordia -n 30 --no-pager 2>/dev/null >&2 || true
echo "" >&2
echo -e "${DIM}  Service status:${RESET}" >&2
systemctl status primordia --no-pager 2>/dev/null >&2 || true' ERR

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
  _done "Using git $(git --version | awk '{print $3}')"
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

# ── Clone Primordia ───────────────────────────────────────────────────────────

_CURRENT_STEP="Clone primordia"
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
  if ! git -C "${BARE_REPO}" worktree add "${INSTALL_DIR}" "${BRANCH}" >"$_log" 2>&1; then _spin_kill; cat "$_log" >&2; rm -f "$_log"; exit 1; fi
  rm -f "$_log"
  _done "Worktree created"
fi

# ── Install bun ───────────────────────────────────────────────────────────────

_CURRENT_STEP="install bun"
export PATH="$HOME/.bun/bin:$PATH"
if [[ ! -f "$HOME/.bun/bin/bun" ]]; then
  _step "Installing bun..."
  _bun_install_log=$(mktemp)
  if ! curl -fsSL https://bun.sh/install | bash >"$_bun_install_log" 2>&1; then
    cat "$_bun_install_log" >&2
    rm -f "$_bun_install_log"
    die "bun installation failed"
  fi
  rm -f "$_bun_install_log"
  _done "Using bun $("$HOME/.bun/bin/bun" --version)"
else
  success "Using bun $("$HOME/.bun/bin/bun" --version)"
fi

# ── Install sfw shim ──────────────────────────────────────────────────────────
# /bin/bun is a shim that routes every bun invocation through sfw (Socket
# Firewall Free) for network traffic filtering during package installs.
# /bin/bun-real symlinks to the actual bun binary at ~/.bun/bin/bun.
# Pointing /bin/bun to the shim intercepts all callers universally — interactive
# shells, non-interactive shells, ssh one-liners, systemd services, and agents.

_CURRENT_STEP="install sfw shim"

# Install sfw globally so the shim can call it
if [[ ! -f "$HOME/.bun/bin/sfw" ]]; then
  _step "Installing sfw..."
  "$HOME/.bun/bin/bun" install -g sfw >/dev/null 2>&1
  _done "Installed sfw"
else
  success "Using sfw"
fi

# Create /bin/bun-real symlink → actual bun binary
if [[ "$(readlink /bin/bun-real 2>/dev/null)" != "$HOME/.bun/bin/bun" ]]; then
  sudo ln -sf "$HOME/.bun/bin/bun" /bin/bun-real
  success "Created /bin/bun-real symlink"
else
  success "Using /bin/bun-real"
fi

# Write the /bin/bun shim (idempotent)
SHIM_CONTENT='#!/usr/bin/env bash
exec bun-real --bun ~/.bun/bin/sfw bun-real "$@"
'
if [[ ! -f /bin/bun ]] || ! diff -q <(echo "$SHIM_CONTENT") /bin/bun >/dev/null 2>&1; then
  echo "$SHIM_CONTENT" | sudo tee /bin/bun >/dev/null
  sudo chmod +x /bin/bun
  success "Installed /bin/bun→sfw shim"
else
  success "Using /bin/bun→sfw shim"
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
else
  PROXY_CHANGED=false
fi

if [[ "${PROXY_CHANGED}" == "true" ]]; then
  cp -f "${REVERSE_PROXY_SOURCE}" "${REVERSE_PROXY_DEST}"
  success "Installed reverse-proxy.ts"
else
  success "Using reverse-proxy.ts"
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
  GENERATED_UNIT=$(cat << UNIT
[Unit]
Description=Primordia Reverse Proxy
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${PRIMORDIA_DIR}
Environment=REVERSE_PROXY_PORT=${REVERSE_PROXY_PORT}
Environment=PRIMORDIA_WORKTREES_DIR=${WORKTREES_DIR}
Environment=HOME=${HOME}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/bun-real ${PRIMORDIA_DIR}/reverse-proxy.ts
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
# we can do a zero-downtime slot swap via POST /_proxy/prod/spawn — the same
# path the "Accept Changes" flow uses.  This keeps existing connections alive.
#
# If either changed, or the proxy isn't running yet, we fall back to the
# traditional restart/start path (brief downtime, unavoidable).

_CURRENT_STEP="deploy new slot"

PROXY_RUNNING=false
if [[ "${PROBABLY_A_SERVER}" == "true" ]] && command -v systemctl &>/dev/null; then
  if systemctl is-active --quiet primordia 2>/dev/null; then
    PROXY_RUNNING=true
  fi
fi

# Reparent sibling sessions whose parent was the old production branch so that
# their "Apply Updates" picks up the new production code going forward.
# Mirrors reparentSiblings() in app/api/evolve/manage/route.ts.
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
  local branch_sha
  branch_sha="$(git -C "${BARE_REPO}" rev-parse "$BRANCH")"

  # Find the worktree (if any) that has main checked out.
  local main_worktree=""
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

  if [[ -n "$main_worktree" ]]; then
    git -C "$main_worktree" reset --hard "$branch_sha"
  else
    git -C "${BARE_REPO}" update-ref refs/heads/main "$branch_sha"
  fi

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

if [[ "${PROXY_RUNNING}" == "true" && "${PROXY_CHANGED}" == "false" && "${SERVICE_CHANGED}" == "false" ]]; then
  # ── Zero-downtime path ────────────────────────────────────────────────────
  # The proxy is running and neither it nor the service unit changed.
  # Tell the proxy to spawn the new production server, health-check it, and
  # cut over atomically — no restart required.
  _step "Deploying to new slot (zero-downtime)..."
  # Stream SSE events from the proxy: print log lines immediately, capture
  # the final done line to check success/failure.
  _SPAWN_FIFO="$(mktemp -u)"
  mkfifo "$_SPAWN_FIFO"
  curl -sf --max-time 60 \
    -X POST "http://localhost:${REVERSE_PROXY_PORT}/_proxy/prod/spawn" \
    -H 'Content-Type: application/json' \
    -d "{\"branch\":\"${BRANCH}\"}" \
    --no-buffer 2>/dev/null \
    | grep '^data: ' | sed 's/^data: //' > "$_SPAWN_FIFO" &
  _SPAWN_CURL_PID=$!
  SPAWN_RESULT=""
  while IFS= read -r _sse_line; do
    SPAWN_RESULT="$_sse_line"
    # Print log-type messages immediately.
    # sed converts JSON-encoded \u001b (ESC) to the actual ESC byte so that
    # ANSI colour codes emitted by the proxy render correctly in the terminal.
    _sse_text="$(echo "$_sse_line" | grep -o '"text":"[^"]*"' | sed 's/"text":"//;s/"$//;s/\\u001b/\x1b/g' || true)"
    if [[ -n "$_sse_text" ]]; then
      printf '%b' "$_sse_text"
    fi
  done < "$_SPAWN_FIFO"
  wait "$_SPAWN_CURL_PID" 2>/dev/null || true
  rm -f "$_SPAWN_FIFO"
  # The last SSE data line is: {"type":"done","ok":true} or {"type":"done","ok":false,"error":"..."}
  if echo "${SPAWN_RESULT}" | grep -q '"ok":true'; then
    SERVICE_READY=true
    _spin_kill
    advance_main_and_push
    echo -e "${GREEN}✓${RESET} Congratulations! Primordia is running!"
  else
    _spin_kill
    SPAWN_ERROR="$(echo "${SPAWN_RESULT}" | grep -o '"error":"[^"]*"' | head -1 || true)"
    warn "Zero-downtime deploy failed (${SPAWN_ERROR:-no response from proxy}). Falling back to service restart."
    # Fall through to the restart path below
  fi
fi

if [[ "${SERVICE_READY}" == "false" ]]; then
  # ── Restart/start path ────────────────────────────────────────────────────
  # Used when: first install, proxy/service changed, or zero-downtime failed.
  # Mark the production branch directly — the proxy will pick it up on start.
  git -C "${BARE_REPO}" config primordia.productionBranch "$BRANCH"

  if [[ "${PROBABLY_A_SERVER}" == "true" ]] && command -v systemctl &>/dev/null; then
    if [[ "${PROXY_RUNNING}" == "true" ]]; then
      sudo systemctl restart --quiet primordia
      success "Restarted primordia systemd service"
    else
      sudo systemctl start --quiet primordia
      success "Started primordia systemd service"
    fi
  fi

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
