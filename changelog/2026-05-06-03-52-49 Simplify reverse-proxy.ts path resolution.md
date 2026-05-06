# Simplify reverse-proxy.ts path resolution

## What changed

Simplified `scripts/reverse-proxy.ts` to eliminate environment-variable-based path discovery:

1. **Removed** `PRIMORDIA_WORKTREES_DIR` environment variable and its fallback to the outdated `/home/exedev/primordia-worktrees`
2. **Removed** the `discoverMainRepo()` function that attempted to infer the main repo from worktree contents
3. **Added** direct path resolution relative to the reverse-proxy.ts file location:
   - `WORKTREES_DIR` is now `{PRIMORDIA_ROOT}/worktrees/`
   - `MAIN_REPO` is now `{PRIMORDIA_ROOT}/source.git`
   - Where `PRIMORDIA_ROOT` is one level above the `scripts/` directory

## Why

The old approach was fragile and relied on outdated hardcoded paths. By computing paths relative to where the reverse-proxy.ts script itself lives, the proxy now:
- Works correctly regardless of where the Primordia installation is located
- Eliminates environment variable dependency
- Removes dead code (unused path discovery logic)
- Makes the path layout explicit and maintainable
