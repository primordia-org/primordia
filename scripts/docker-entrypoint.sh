#!/usr/bin/env bash
set -euo pipefail

export PRIMORDIA_DIR="${PRIMORDIA_DIR:-/data}"
export REVERSE_PROXY_PORT="${REVERSE_PROXY_PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

IMAGE_APP_DIR="/opt/primordia"
APP_DIR="${PRIMORDIA_DIR}/source.git"
PROXY_FILE="${PRIMORDIA_DIR}/reverse-proxy.ts"

log() { printf '[primordia-docker] %s\n' "$*"; }

mkdir -p "$PRIMORDIA_DIR" "${PRIMORDIA_DIR}/worktrees" "${PRIMORDIA_DIR}/past-sessions"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git config --global --add safe.directory "$IMAGE_APP_DIR" 2>/dev/null || true

if [[ ! -d "$APP_DIR/.git" ]]; then
  log "initializing persistent Primordia tree in $APP_DIR"
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR"
  rsync -a --delete \
    --exclude '.primordia-auth.db' \
    --exclude '.primordia-auth.db-*' \
    --exclude '.primordia-session.ndjson' \
    --exclude 'past-sessions' \
    --exclude 'worktrees' \
    "$IMAGE_APP_DIR/" "$APP_DIR/"

  if [[ ! -d "$APP_DIR/.git" ]]; then
    log "image build context did not include .git; creating an initial local repository"
    git -C "$APP_DIR" init -b main
    git -C "$APP_DIR" config user.email "primordia@docker.local"
    git -C "$APP_DIR" config user.name "Primordia Docker"
    git -C "$APP_DIR" add . ':!node_modules' ':!.next'
    git -C "$APP_DIR" commit -m "Initial Primordia Docker import"
  fi
fi

cp "$APP_DIR/scripts/reverse-proxy.ts" "$PROXY_FILE"

if [[ ! -f "$APP_DIR/.env.local" ]]; then
  log "creating .env.local"
  cat > "$APP_DIR/.env.local" <<EOF_ENV
REVERSE_PROXY_PORT=${REVERSE_PROXY_PORT}
PRIMORDIA_DIR=${PRIMORDIA_DIR}
EOF_ENV
fi

if [[ ! -d "$APP_DIR/node_modules" ]]; then
  log "installing dependencies"
  bun install --cwd "$APP_DIR" --frozen-lockfile
fi

if [[ ! -d "$APP_DIR/.next" || "${PRIMORDIA_DOCKER_REBUILD_ON_START:-0}" == "1" ]]; then
  log "building production app"
  bun run --cwd "$APP_DIR" build
fi

current_branch="$(git -C "$APP_DIR" symbolic-ref --short HEAD 2>/dev/null || true)"
if [[ -z "$current_branch" ]]; then
  current_branch="main"
fi

if ! git -C "$APP_DIR" config --get primordia.productionBranch >/dev/null 2>&1; then
  git -C "$APP_DIR" config primordia.productionBranch "$current_branch"
fi

if ! git -C "$APP_DIR" config --get "branch.${current_branch}.port" >/dev/null 2>&1; then
  git -C "$APP_DIR" config "branch.${current_branch}.port" "$((REVERSE_PROXY_PORT + 1))"
fi

log "starting Primordia proxy on :${REVERSE_PROXY_PORT}"
cd "$PRIMORDIA_DIR"
exec bun "$PROXY_FILE"
