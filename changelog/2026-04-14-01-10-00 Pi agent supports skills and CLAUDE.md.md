# Pi Agent: Skills and CLAUDE.md Support

## What changed

Two gaps were identified and fixed in the pi coding agent integration — both solved with git-tracked symlinks, requiring zero code changes to `pi-worker.ts`.

### 1. Skills from `.claude/skills/` now loaded

Pi's `DefaultResourceLoader` only auto-discovers skills from:
- `~/.pi/agent/skills/`
- `~/.agents/skills/`
- `.pi/skills/`
- `.agents/skills/` walking up from `cwd`

The project stores skills in `.claude/skills/` (the Claude Code convention — `using-exe-dev` and `caveman`). Pi does **not** discover `.claude/skills/` automatically.

**Fix:** Added `.pi/skills` as a symlink to `../.claude/skills`. Pi discovers `.pi/skills/` automatically and treats direct `.md` files in it as individual skills, so `using-exe-dev.md` and `caveman.md` are both picked up via the symlink.

### 2. CLAUDE.md now used as project context

Pi's `DefaultResourceLoader` only reads `AGENTS.md` context files (walking up from `cwd`), not Claude Code's `CLAUDE.md` convention.

**Fix:** Added `AGENTS.md` as a symlink to `CLAUDE.md`. Pi finds `AGENTS.md` in the worktree root and loads it as the project context file — which is exactly `CLAUDE.md`'s content.

## Why symlinks instead of code/config changes

Both symlinks are git-tracked, so every worktree gets them automatically. No changes to `pi-worker.ts` or settings files were needed. The `.pi/` directory exists solely to hold the `skills` symlink.

## Why this matters

Without these, pi-based evolve sessions ran without:
- Awareness of project conventions, architecture, and design principles (CLAUDE.md)
- The `using-exe-dev` skill (guidance for working with exe.dev infrastructure)
- The `caveman` skill (token-efficient communication mode)

Claude Code-based sessions already received all of this via its native support for `.claude/` conventions. This change brings pi-based sessions to parity.
