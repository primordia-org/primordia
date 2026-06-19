#!/usr/bin/env bash
set -euo pipefail

export PRIMORDIA_DIR="${PRIMORDIA_DIR:-/data}"
export REVERSE_PROXY_PORT="${REVERSE_PROXY_PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export HOME="${HOME:-/root}"

SEED_DIR="/opt/primordia-seed"
BARE_REPO="${PRIMORDIA_DIR}/source.git"
WORKTREES_DIR="${PRIMORDIA_DIR}/worktrees"
MISE_BIN="${HOME}/.local/bin/mise"

log() { printf '[primordia-docker] %s\n' "$*"; }

mkdir -p "$PRIMORDIA_DIR" "$WORKTREES_DIR" "${PRIMORDIA_DIR}/past-sessions"
git config --global --add safe.directory "$SEED_DIR" 2>/dev/null || true
git config --global --add safe.directory "$BARE_REPO" 2>/dev/null || true

if [[ ! -d "$BARE_REPO" ]]; then
  log "seeding persistent git repository in $BARE_REPO"
  if [[ -d "$SEED_DIR/.git" ]]; then
    git clone --bare "$SEED_DIR" "$BARE_REPO"
  else
    log "image build context did not include .git; creating a local seed repository"
    tmp_seed="$(mktemp -d)"
    rsync -a --exclude '.git' --exclude 'node_modules' --exclude '.next' "$SEED_DIR/" "$tmp_seed/"
    git -C "$tmp_seed" init -b main
    git -C "$tmp_seed" config user.email "primordia@docker.local"
    git -C "$tmp_seed" config user.name "Primordia Docker"
    git -C "$tmp_seed" add .
    git -C "$tmp_seed" commit -m "Initial Primordia Docker import"
    git clone --bare "$tmp_seed" "$BARE_REPO"
    rm -rf "$tmp_seed"
  fi
  git -C "$BARE_REPO" config user.email "primordia@localhost"
  git -C "$BARE_REPO" config user.name "Primordia"
fi

BOOT_BRANCH="${PRIMORDIA_DOCKER_BRANCH:-$(git -C "$BARE_REPO" symbolic-ref --short HEAD 2>/dev/null || true)}"
if [[ -z "$BOOT_BRANCH" ]]; then
  BOOT_BRANCH="main"
fi
BOOT_WORKTREE="${WORKTREES_DIR}/${BOOT_BRANCH}"
git config --global --add safe.directory "$BOOT_WORKTREE" 2>/dev/null || true

if [[ ! -d "$BOOT_WORKTREE/.git" ]]; then
  log "creating ${BOOT_BRANCH} worktree"
  rm -rf "$BOOT_WORKTREE"
  git -C "$BARE_REPO" worktree add "$BOOT_WORKTREE" "$BOOT_BRANCH"
fi

if [[ ! -f "$BOOT_WORKTREE/.env.local" ]]; then
  log "creating .env.local"
  cat > "$BOOT_WORKTREE/.env.local" <<EOF_ENV
REVERSE_PROXY_PORT=${REVERSE_PROXY_PORT}
PRIMORDIA_DIR=${PRIMORDIA_DIR}
EOF_ENV
fi

log "running Primordia installer"
REPORT_STYLE=plain bash "$BOOT_WORKTREE/scripts/install.sh" "$BOOT_BRANCH"

if [[ ! -x "$MISE_BIN" ]]; then
  MISE_BIN="$(command -v mise || true)"
fi
if [[ -z "$MISE_BIN" || ! -x "$MISE_BIN" ]]; then
  echo "mise was not installed by scripts/install.sh" >&2
  exit 1
fi

export PATH="$(dirname "$MISE_BIN"):${HOME}/.local/share/mise/shims:${PATH}"
export MISE_TRUSTED_CONFIG_PATHS="${PRIMORDIA_DIR}:${WORKTREES_DIR}${MISE_TRUSTED_CONFIG_PATHS:+:${MISE_TRUSTED_CONFIG_PATHS}}"

log "starting Primordia proxy on :${REVERSE_PROXY_PORT}"
cd "$PRIMORDIA_DIR"
exec "$MISE_BIN" exec -C "$PRIMORDIA_DIR" -- bun "$PRIMORDIA_DIR/reverse-proxy.ts"
