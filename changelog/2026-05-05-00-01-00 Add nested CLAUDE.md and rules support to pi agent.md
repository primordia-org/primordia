# Add nested CLAUDE.md and `.claude/rules/` support to pi agent

## What changed

`scripts/pi-worker.ts` now discovers and injects the same context files that Claude Code loads natively:

1. **Nested `CLAUDE.md` / `AGENTS.md` files** — any `CLAUDE.md` or `AGENTS.md` found in subdirectories of the worktree (e.g. `app/api/evolve/CLAUDE.md`, `lib/CLAUDE.md`) is injected into the pi session alongside the root context file the SDK already discovers.

2. **Path-scoped `.claude/rules/*.md` files** — rules files with `paths:` YAML frontmatter are included only when their glob patterns match at least one file that exists in the worktree, mirroring Claude Code's lazy-load behaviour. Rules files without frontmatter are always included.

Both are injected via `DefaultResourceLoader`'s `agentsFilesOverride` hook, so they appear as additional `agentsFiles` entries alongside the standard `AGENTS.md` discovery.

## Why

After splitting the root `CLAUDE.md` into nested files and path-scoped rules (previous change), pi was only loading the root `AGENTS.md` symlink and missing all the detail that was moved to subdirectory files and `.claude/rules/`. This brings pi's context loading into parity with Claude Code.
