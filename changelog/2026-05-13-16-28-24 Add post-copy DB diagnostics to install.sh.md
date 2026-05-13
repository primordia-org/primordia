# Add post-copy diagnostics to install.sh

## What changed

`scripts/install.sh` has seen recurring `✓ DB copied → ❌ exit 1` failures
where the DB copy succeeds but the script exits with code 1 shortly after —
without printing ERR trap output, making it impossible to tell which line
failed. Two root causes addressed:

### 1. `set -E` (errtrace) added

Changed `set -euo pipefail` to `set -eEuo pipefail`.

Without `-E`, bash does not propagate the ERR trap into shell functions.
A failure inside `advance_main_and_push` causes the function to exit with
a non-zero status, but `$LINENO` in the ERR trap points to the function
*call site*, not the actual failing line. With `-E`, the ERR trap fires
at the exact line that failed, even inside functions.

### 2. Granular `_CURRENT_STEP` updates and `diag` lines

The entire post-copy section was under a single `_CURRENT_STEP="deploy new slot"`.
Now every sub-step has its own value so the ERR trap message is actionable:

- `copy production DB`
- `zero-downtime spawn: create FIFO`
- `zero-downtime spawn: curl /_proxy/prod/spawn` — with a `diag` line showing the branch + port
- `zero-downtime spawn: read SSE stream`
- `zero-downtime spawn: evaluate result` — with a `diag` line showing the raw SSE result
- `set production branch in git config` — with a `diag` line showing the branch name
- `restart systemd service` / `start systemd service`
- `wait for service to be ready`
- Inside `advance_main_and_push`: four sub-steps each with a `diag` line showing
  the SHA, worktree path, and which git command is about to run
- `advance main ref and push mirror (non-server)`

### 3. `_wt_path` / `_wt_branch` declared `local`

These scratch variables inside `advance_main_and_push` were leaking into the
outer script scope. Made them `local`.

## Why

The DB copy step succeeds (the `✓ DB copied` line appears), but the script
exits 1 somewhere in the deploy section that follows. The ERR trap either
wasn't firing inside functions (fixed by `set -E`) or was firing but
reporting an unhelpful step name (fixed by the granular `_CURRENT_STEP`
updates). The `diag` lines ensure the exact git command, branch, SHA, and
proxy response are visible in the log at the moment of failure.
