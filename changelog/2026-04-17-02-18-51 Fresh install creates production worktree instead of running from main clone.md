# Fresh install creates production worktree instead of running from main clone

## What changed

### `scripts/install.sh`

Added a **"setup production worktree"** step that runs immediately after locating the repo root, before `bun install`.

When `install.sh` detects it is running inside the main git clone (i.e. `$INSTALL_DIR/.git` is a directory, not the symlink file that linked worktrees have), it:

1. Asks git which remote-tracking branches point at the same HEAD commit as `main`, excluding `main` itself:
   ```
   git branch -r --points-at HEAD | grep -v '->' | grep -v '/main$'
   ```
2. Takes the first match as the **production branch** (the server always keeps one such branch — the branch currently serving production).
3. Creates a linked worktree at `~/primordia-worktrees/<production-branch>` using `git worktree add -b <branch> origin/<branch>`.
4. Redirects `INSTALL_DIR` to that worktree so all subsequent steps (`bun install`, `bun run build`, `install-service.sh`) operate in the correct location.

If no non-main branch is found at HEAD the installer warns and falls back to the original behaviour (using `~/primordia` directly), so reinstalls on already-configured machines degrade gracefully.

Also updated the display message for the `install-service.sh` invocation to use `$INSTALL_DIR` rather than the hardcoded `~/primordia`.

### `scripts/install-service.sh`

Fixed `WORKTREES_DIR` derivation. The old code was:
```bash
WORKTREES_DIR="${REPO_ROOT}/../primordia-worktrees"
```
This assumed `REPO_ROOT` was always `~/primordia`. After the `install.sh` change, `REPO_ROOT` is `~/primordia-worktrees/<branch>`, which made `WORKTREES_DIR` resolve to `~/primordia-worktrees/primordia-worktrees` — wrong.

The fix uses `git rev-parse --git-common-dir` to reliably locate the main clone regardless of whether we are executing from the main checkout or a linked worktree:

```bash
_GIT_COMMON_DIR=$(git -C "${REPO_ROOT}" rev-parse --git-common-dir)
# absolute path  → we're in a worktree; strip trailing /.git to get main repo
# relative ".git" → we're in the main clone; REPO_ROOT is already correct
if [[ "${_GIT_COMMON_DIR}" == /* ]]; then
  _MAIN_REPO="$(dirname "${_GIT_COMMON_DIR}")"
else
  _MAIN_REPO="${REPO_ROOT}"
fi
WORKTREES_DIR="${_MAIN_REPO}/../primordia-worktrees"
```

## Why

On a fresh install (`curl … | bash`) the repo was cloned to `~/primordia` with `main` checked out. The production Next.js server is expected to run from `~/primordia-worktrees/<branch>`, but:

- git forbids checking out the same branch in two places simultaneously, so `git worktree add … main` would fail.
- The reverse proxy's `discoverMainRepo()` walks `PRIMORDIA_WORKTREES_DIR` to find the git repo; if that directory is empty the proxy falls back to `process.cwd()` (`/home/exedev/primordia`) rather than the intended worktree path.

By creating the worktree during install and redirecting all build steps into it, the production server is set up in `~/primordia-worktrees/<branch>` from day one, matching how the system operates after any subsequent blue-green deploy.
