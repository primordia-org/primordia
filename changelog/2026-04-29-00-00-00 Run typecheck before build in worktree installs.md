# Run typecheck before build in worktree installs

## What changed

`scripts/install.sh` now runs `bun run typecheck` between `bun install` and
`bun run build`, but **only when the script is invoked from within an existing
git worktree** (i.e. a worktree/slot install, such as the blue-green accept
pipeline or a manual update to an existing deployment).

A new boolean variable `IS_WORKTREE_INSTALL` is set to `true` when the script
detects it is running from inside a git work-tree (the existing `SCRIPT_DIR`
check). First-time installs — where the script is piped via `curl | bash` on a
fresh machine — set `IS_WORKTREE_INSTALL=false` and skip the typecheck step.

## Why

TypeScript errors are now surfaced immediately, with clear output, before the
much longer `bun run build` step begins. This gives faster feedback when a
worktree contains type errors and avoids confusing Next.js build errors that can
obscure the underlying TypeScript problem.

The typecheck is skipped on first-time installs because there is no existing
production slot to compare against and the build already surfaces type errors
(albeit more slowly). Keeping first-time installs lean also reduces the chance
of a broken install on a fresh machine where the environment may differ.
