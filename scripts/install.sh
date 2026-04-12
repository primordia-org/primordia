#!/usr/bin/env bash
# scripts/install.sh
# One-command Primordia installer for exe.dev servers.
#
# Usage (run this on your exe.dev server):
#   curl -fsSL https://raw.githubusercontent.com/boldsoftware/primordia/main/scripts/install.sh | bash
#
# Or with a custom fork:
#   PRIMORDIA_REPO=your-username/primordia \
#     curl -fsSL https://raw.githubusercontent.com/boldsoftware/primordia/main/scripts/install.sh | bash
#
# What it does:
#   1. Installs git and bun if missing
#   2. Clones Primordia into ~/primordia
#   3. Prompts for your Anthropic API key (required for the evolve pipeline)
#   4. Writes ~/.env.local and installs it into the repo
#   5. Builds Primordia and starts it as a systemd service
#   6. Prints the URL to open in your browser

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

PRIMORDIA_REPO="${PRIMORDIA_REPO:-boldsoftware/primordia}"
PRIMORDIA_REPO_URL="https://github.com/${PRIMORDIA_REPO}.git"
INSTALL_DIR="${INSTALL_DIR:-$HOME/primordia}"
REVERSE_PROXY_PORT="${REVERSE_PROXY_PORT:-3000}"

# ── Colours ───────────────────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  BOLD="\033[1m"
  GREEN="\033[0;32m"
  CYAN="\033[0;36m"
  YELLOW="\033[0;33m"
  RED="\033[0;31m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" CYAN="" YELLOW="" RED="" RESET=""
fi

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
die()     { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}  Primordia Installer${RESET}"
echo -e "  A self-modifying AI web app — powered by Claude"
echo ""
echo -e "  Repo:    ${PRIMORDIA_REPO_URL}"
echo -e "  Install: ${INSTALL_DIR}"
echo ""

# ── Detect exe.dev ────────────────────────────────────────────────────────────

HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
if [[ "$HOSTNAME_FQDN" == *.exe.xyz ]]; then
  SERVER_NAME="${HOSTNAME_FQDN%.exe.xyz}"
  info "Detected exe.dev server: ${SERVER_NAME}.exe.xyz"
  APP_URL="http://${HOSTNAME_FQDN}:${REVERSE_PROXY_PORT}"
else
  warn "Not running on exe.dev — some features (SSO login, LLM gateway) won't be available."
  APP_URL="http://localhost:${REVERSE_PROXY_PORT}"
fi

echo ""

# ── Check for existing install ────────────────────────────────────────────────

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  warn "Primordia is already installed at ${INSTALL_DIR}."
  warn "To update, run:  git -C ${INSTALL_DIR} pull && bun run build"
  exit 0
fi

# ── Install git ───────────────────────────────────────────────────────────────

if ! command -v git &>/dev/null; then
  info "Installing git..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y git curl
  elif command -v yum &>/dev/null; then
    sudo yum install -y git curl
  else
    die "Cannot install git — no recognised package manager found (tried apt-get, yum)."
  fi
fi
success "git $(git --version | awk '{print $3}')"

# ── Install bun ───────────────────────────────────────────────────────────────

export PATH="$HOME/.bun/bin:$PATH"
if ! command -v bun &>/dev/null; then
  info "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
success "bun $(bun --version)"

echo ""

# ── Configure git identity ────────────────────────────────────────────────────

git config --global user.name  "Primordia" 2>/dev/null || true
git config --global user.email "primordia@localhost" 2>/dev/null || true

# ── Prompt for configuration ──────────────────────────────────────────────────

echo -e "${BOLD}Configuration${RESET}"
echo ""

# ANTHROPIC_API_KEY — required for the evolve (Claude Code) pipeline
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo -e "  An ${BOLD}Anthropic API key${RESET} is required for the Evolve pipeline (Claude Code)."
  echo -e "  Get one at: https://console.anthropic.com"
  if [[ -t 0 ]]; then
    echo ""
    read -rp "  ANTHROPIC_API_KEY: " ANTHROPIC_API_KEY
    echo ""
    if [[ -z "$ANTHROPIC_API_KEY" ]]; then
      warn "No API key entered. Evolve mode will be disabled. You can add it to ${INSTALL_DIR}/.env.local later."
    fi
  else
    # Non-interactive (piped to bash without a tty) — inform, continue without it
    warn "Running non-interactively — no API key provided."
    warn "Add ANTHROPIC_API_KEY to ${INSTALL_DIR}/.env.local to enable Evolve mode."
    ANTHROPIC_API_KEY=""
  fi
fi

# GITHUB_REPO / GITHUB_TOKEN — optional, enables git sync
GITHUB_REPO_VALUE="${GITHUB_REPO:-}"
GITHUB_TOKEN_VALUE="${GITHUB_TOKEN:-}"

if [[ -t 0 ]]; then
  echo -e "  ${BOLD}GitHub credentials${RESET} (optional — enables the Git Sync dialog)."
  echo ""
  read -rp "  GITHUB_REPO (e.g. your-username/primordia, or leave blank): " GITHUB_REPO_VALUE
  if [[ -n "$GITHUB_REPO_VALUE" ]]; then
    read -rp "  GITHUB_TOKEN (PAT with repo scope, or leave blank): " GITHUB_TOKEN_VALUE
  fi
  echo ""
fi

# ── Clone repo ────────────────────────────────────────────────────────────────

echo -e "${BOLD}Installing Primordia${RESET}"
echo ""
info "Cloning ${PRIMORDIA_REPO_URL}..."
git clone "${PRIMORDIA_REPO_URL}" "${INSTALL_DIR}"
success "Cloned to ${INSTALL_DIR}"

# ── Write .env.local ──────────────────────────────────────────────────────────

ENV_FILE="${INSTALL_DIR}/.env.local"

cat > "${ENV_FILE}" <<EOF
# Generated by Primordia installer — $(date -u '+%Y-%m-%d %H:%M:%S UTC')

REVERSE_PROXY_PORT=${REVERSE_PROXY_PORT}
EOF

if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" >> "${ENV_FILE}"
fi

if [[ -n "${GITHUB_REPO_VALUE:-}" ]]; then
  echo "GITHUB_REPO=${GITHUB_REPO_VALUE}" >> "${ENV_FILE}"
fi

if [[ -n "${GITHUB_TOKEN_VALUE:-}" ]]; then
  echo "GITHUB_TOKEN=${GITHUB_TOKEN_VALUE}" >> "${ENV_FILE}"
fi

success "Wrote ${ENV_FILE}"

# ── Install dependencies ──────────────────────────────────────────────────────

info "Installing dependencies (bun install)..."
cd "${INSTALL_DIR}"
bun install --frozen-lockfile
success "Dependencies installed"

# ── Build production bundle ───────────────────────────────────────────────────

info "Building production bundle (bun run build)..."
bun run build
success "Build complete"

# ── Install systemd service ───────────────────────────────────────────────────

echo ""
info "Installing systemd service..."
bash "${INSTALL_DIR}/scripts/install-service.sh"

# ── Wait for ready ────────────────────────────────────────────────────────────

echo ""
info "Waiting for Primordia to be ready (up to 60 s)..."
for i in $(seq 1 30); do
  sleep 2
  if journalctl -u primordia-proxy -n 100 --no-pager 2>/dev/null | grep -q "Ready"; then
    echo ""
    success "Primordia is ready!"
    break
  fi
  if [[ $((i % 5)) -eq 0 ]]; then
    info "$((i * 2))s..."
  fi
done

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${GREEN}  Primordia is running!${RESET}"
echo ""
echo -e "  Open:     ${BOLD}${APP_URL}${RESET}"
echo ""
if [[ "$HOSTNAME_FQDN" == *.exe.xyz ]]; then
  echo -e "  Sign in with your exe.dev account on the login page."
  echo -e "  The first user to sign in is automatically granted the admin role."
else
  echo -e "  Register a passkey on the login page."
  echo -e "  The first user to register is automatically granted the admin role."
fi
echo ""
echo -e "  Useful commands:"
echo -e "    journalctl -u primordia-proxy -f         # tail proxy logs"
echo -e "    sudo systemctl restart primordia-proxy   # restart"
echo -e "    sudo systemctl stop primordia-proxy      # stop"
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  echo ""
  echo -e "  ${GREEN}Evolve mode is enabled.${RESET} Visit /evolve to propose changes to the app."
else
  echo ""
  echo -e "  ${YELLOW}Evolve mode is disabled.${RESET} Add ANTHROPIC_API_KEY to ${INSTALL_DIR}/.env.local"
  echo -e "  and restart the service to enable it."
fi
echo ""
