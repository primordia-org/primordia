# Run typecheck before build in worktree installs

## What changed

### `scripts/install.sh`

- Runs `bun run typecheck` between `bun install` and `bun run build`, but
  **only when the script is invoked from within an existing git worktree**
  (i.e. a worktree/slot install, such as the blue-green accept pipeline or a
  manual update to an existing deployment).
- A new boolean variable `IS_WORKTREE_INSTALL` is set to `true` when the
  script detects it is running inside a git work-tree (the existing
  `SCRIPT_DIR` check). First-time installs — where the script is piped via
  `curl | bash` on a fresh machine — set `IS_WORKTREE_INSTALL=false` and skip
  the typecheck step.
- On typecheck failure the script **exits with code `2`** (distinct from the
  general failure code `1`) and writes the raw `tsc` output to
  `.primordia-typecheck-errors.txt` in the worktree so the accept endpoint can
  read it without reparsing stderr.

### `app/api/evolve/manage/route.ts`

- The redundant explicit `bun run typecheck` call that previously ran before
  `install.sh` has been removed — the script now handles it.
- A shared `runInstallSh()` helper centralises the `spawn` + stream-to-log
  logic used by both `runAcceptAsync` and `retryAcceptAfterFix`.
- `runAcceptAsync` detects exit code `2`, reads
  `.primordia-typecheck-errors.txt`, and triggers the existing auto-fix Claude
  session (`fixing-types` → `retryAcceptAfterFix`), exactly as before.
- `retryAcceptAfterFix` is simplified: instead of re-running `tsc` and
  `bun run build` manually it now re-runs `install.sh`. Exit code `2` means
  typecheck still failing (session goes to error); code `0` means success
  (deploy completes); any other non-zero code is a generic install error.
- The "Running install.sh…" log line that was emitted before spawning
  `install.sh` has been removed — it was redundant given that `install.sh`
  already logs its own progress.

## Why

TypeScript errors are surfaced immediately, with clear output, before the much
longer `bun run build` step begins, giving faster feedback. The exit-code
convention lets the accept endpoint distinguish a typecheck failure (auto-fixable
by Claude) from other install failures (not auto-fixable), preserving the full
auto-fix loop.

The typecheck is skipped on first-time installs because there is no existing
production slot to compare against and the build already surfaces type errors
(albeit more slowly). Keeping first-time installs lean also reduces the chance
of a broken install on a fresh machine where the environment may differ.
