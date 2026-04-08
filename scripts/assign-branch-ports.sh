#!/usr/bin/env bash
# scripts/assign-branch-ports.sh
# Idempotent migration: assigns an ephemeral port to every local git branch
# that does not already have one stored as branch.{name}.port in git config.
#
# Usage: bash scripts/assign-branch-ports.sh [repo-root]
# Defaults to the current directory as repo root.

set -euo pipefail

REPO_ROOT="${1:-$(pwd)}"
cd "$REPO_ROOT"

echo "Assigning ephemeral ports to local branches..."

# Collect all already-assigned ports into a set.
declare -A ASSIGNED_PORTS
while read -r key value; do
  ASSIGNED_PORTS["$value"]=1
done < <(git config --get-regexp 'branch\..*\.port' 2>/dev/null || true)

# Ensure main gets 3001 (the production port).
if git config --get "branch.main.port" >/dev/null 2>&1; then
  echo "  Already has port $(git config --get branch.main.port) → main"
else
  git config "branch.main.port" "3001"
  ASSIGNED_PORTS["3001"]=1
  echo "  Assigned port 3001 → main"
fi

# Assign ports to all other branches.
NEXT_PORT=3002
while IFS= read -r branch; do
  [[ "$branch" == "main" ]] && continue

  if git config --get "branch.${branch}.port" >/dev/null 2>&1; then
    echo "  Already has port $(git config --get "branch.${branch}.port") → ${branch}"
    continue
  fi

  # Find the next unused port.
  while [[ -n "${ASSIGNED_PORTS[$NEXT_PORT]+x}" ]]; do
    ((NEXT_PORT++))
  done

  git config "branch.${branch}.port" "$NEXT_PORT"
  ASSIGNED_PORTS["$NEXT_PORT"]=1
  echo "  Assigned port $NEXT_PORT → $branch"
  ((NEXT_PORT++))
done < <(git branch --format='%(refname:short)' 2>/dev/null)

echo "Done."
