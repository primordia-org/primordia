# Flatten worktree directory structure

## What changed

### `app/api/evolve/local/route.ts`
- Worktree paths are now derived from `git rev-parse --git-common-dir` instead of
  `path.join(process.cwd(), '..', 'primordia-worktrees', branch)`.
- **Flat layout** (`$PRIMORDIA_DIR/main` as the main repo): worktrees are created at
  `$PRIMORDIA_DIR/{branch}` — direct siblings of `main`, never nested.
- **Legacy layout** (main repo not named `main`): falls back to the old
  `../primordia-worktrees/{branch}` path so existing installs keep working without
  any migration.

### `lib/local-evolve-sessions.ts`
- The Bash boundary hook now uses a regex lookahead instead of a plain `includes()`
  when checking whether a command references the main repo root. The lookahead
  (`(?=[/\s"'\`]|$)`) requires the path to appear as a proper path component, not
  merely as a prefix of another path. This eliminates false-positive blocks when a
  command mentions a worktree path that starts with the same prefix as the main repo
  root (e.g. `/…/primordia` was falsely matching `/…/primordia-worktrees/…`).

### `PRIMORDIA.md`
- Updated the evolve data-flow section to document `$PRIMORDIA_DIR/{slug}` as the
  worktree path convention.

## Why

Two bugs affected worktree isolation:

1. **False-positive boundary blocks.** The main repo lived at `/home/exedev/primordia`
   and worktrees at `/home/exedev/primordia-worktrees/…`. Because `primordia` is a
   string prefix of `primordia-worktrees`, a simple `includes(repoRoot)` check in the
   Bash boundary hook would block legitimate commands that referenced worktree paths
   (e.g. `mkdir /home/exedev/primordia-worktrees/…`).

2. **Russian nesting-doll paths.** When the app runs inside a worktree (e.g. after
   accepting a change and the new code itself spawns further evolve sessions), the old
   `process.cwd() + '/../primordia-worktrees/…'` calculation produced paths like
   `/home/exedev/primordia-worktrees/primordia-worktrees/primordia-worktrees/branch`,
   which are confusing for both humans and LLMs.

## Migration (one-time, manual SSH steps)

To move from the legacy layout to the flat layout, stop the app and run:

```bash
# Move the main repo into a dedicated subdirectory called "main"
mv /home/exedev/primordia /home/exedev/primordia-tmp
mkdir /home/exedev/primordia
mv /home/exedev/primordia-tmp /home/exedev/primordia/main

# Prune any stale worktree references from the old location
git -C /home/exedev/primordia/main worktree prune

# (Optional) remove the now-orphaned legacy worktrees directory
# rm -rf /home/exedev/primordia-worktrees

# Restart the app from the new location
cd /home/exedev/primordia/main && bun run dev
```

After migration, new worktrees will be created at `/home/exedev/primordia/{branch}` —
flat siblings of `main` with no prefix-collision and no nesting risk.

> **Bootstrapping note.** This branch (`flatten-worktree-structure`) can be merged into
> `main` using the normal evolve Accept flow or manually via
> `git -C /home/exedev/primordia merge flatten-worktree-structure --no-ff`. The
> migration above is a separate step performed *after* the merge, over SSH.
