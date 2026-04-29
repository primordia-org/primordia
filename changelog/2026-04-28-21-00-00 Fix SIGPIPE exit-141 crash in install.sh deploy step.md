# Fix SIGPIPE exit-141 crash in install.sh deploy step

## What failed

The `post-body-params-docs` session crashed at accept-time with:

```
✗ Install failed at step: deploy new slot (line 415, exit 141)
Accept failed (unexpected error): install.sh exited with code 141
```

Exit code **141 = 128 + 13 (SIGPIPE)**. The script uses `set -euo pipefail`.

## Root cause

Three pipelines in `scripts/install.sh` use early-exit patterns that cause SIGPIPE:

### 1. Primary failure — line 412–413 (DB copy worktree lookup)

```bash
OLD_SLOT="$(git -C "${BARE_REPO}" worktree list --porcelain \
    | awk '/^worktree /{p=$2} /^branch refs\/heads\/'"${OLD_PROD_BRANCH}"'$/{print p; exit}')"
```

`awk` calls `exit` once it finds the matching branch, which closes the read end of
the pipe while `git worktree list` is still writing output. Git receives SIGPIPE
(signal 13) and exits with code 141. With `set -o pipefail`, the pipeline returns
141. With `set -e`, bash triggers the ERR trap. `$LINENO` in the trap pointed to
line 415 (the `_step` call immediately after the `if` block) due to a known bash
imprecision with multi-line command substitutions.

### 2. Latent bug — line 193 (branch name calculation)

```bash
BRANCH="$(git ... | grep -v 'main' | head -1)"
```

`head -1` exits after reading one line, causing grep and potentially git to receive
SIGPIPE. Harmless on a fresh install (usually only one matching branch), but would
fail the install if multiple branches pointed at the same commit as main.

### 3. Latent bug — line 456 (mirror push check)

```bash
if git -C "${BARE_REPO}" remote | grep -qx mirror; then
```

`grep -q` exits immediately on the first match. Git receives SIGPIPE (141). With
`set -o pipefail`, the pipeline exits 141 (non-zero), causing the `if` to evaluate
as **false** and silently skipping the mirror push even when the mirror remote
exists and was reachable.

## Fix

Added `|| true` at the end of pipelines inside `$(...)` to prevent the SIGPIPE
from the early-exit consumer from propagating as a fatal error:

```bash
# Line 193
BRANCH="$(git ... | grep -v 'main' | head -1 || true)"

# Line 412–413
OLD_SLOT="$(git ... | awk '...{print p; exit}' || true)"
```

Replaced the `git remote | grep -qx mirror` check with a direct git config lookup
that requires no pipe at all:

```bash
# Line 456
if git -C "${BARE_REPO}" config --get remote.mirror.url &>/dev/null; then
```

`|| true` inside a `$(...)` subshell catches the non-zero pipeline exit code
(141) before bash sees it, while preserving the value already printed by awk/head
to stdout. The `config --get` approach eliminates the pipe entirely.
