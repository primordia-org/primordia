# Flat Worktree Directory Structure

## What Changed

The worktree path construction in `app/api/evolve/route.ts` was updated from:

```
../primordia-worktrees/{slug}
```

to:

```
../{slug}
```

All new evolve worktrees are now created as **siblings** of the current working directory (the main repo or any other worktree), rather than being nested inside a dedicated `primordia-worktrees/` subdirectory.

The data flow description in `PRIMORDIA.md` was also updated to match.

## Why

The previous layout caused a **russian nesting doll problem**: because `process.cwd()` inside any given worktree already pointed into `primordia-worktrees/`, the old path join `../primordia-worktrees/{slug}` would resolve to `primordia-worktrees/primordia-worktrees/{slug}`. When that worktree in turn spawned another evolve session, the path grew by yet another level, producing deeply nested paths like:

```
/home/exedev/primordia-worktrees/primordia-worktrees/primordia-worktrees/primordia-worktrees/test-git-availability-2
```

These long, repetitive paths are hard for humans to track and confusing for LLMs navigating the codebase.

The flat layout keeps every worktree at the same depth, so paths are always short and unambiguous:

```
/home/exedev/main
/home/exedev/branch-name
/home/exedev/another-branch-name
```
