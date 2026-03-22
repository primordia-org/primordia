# Live edit mode for local evolve

## What changed

Added a **⚡ Live** mode to the local evolve flow alongside the existing **🌿 Worktree** mode.

### New behaviour

- **Live mode (default on non-main branches):** Claude Code runs directly in the current repo. Changes appear instantly via Next.js HMR — no new tab, no second dev server. When Claude finishes, Accept/Reject buttons appear inline in the `/evolve` page. Accept commits; Reject reverts with `git restore + git clean`.
- **Worktree mode (unchanged, and the only option on `main`):** Isolated git worktree + separate Next.js dev server, previewed in a new tab.
- A small toggle (⚡ Live / 🌿 Worktree) is shown in the evolve form when `NODE_ENV=development`. The Live button is disabled with a tooltip on `main`/`master`.

### Why live mode is blocked on main

Editing `main` directly risks a half-applied state with no easy escape hatch. On a feature branch, the worst case is `git restore` — the branch can be deleted if things go wrong.

### Safety hook

Live edit installs a `PreToolUse` hook that blocks `Write` and `Edit` operations on files that are unsafe to hot-reload:
- `lib/local-evolve-sessions.ts` (module-level singleton — hot reload destroys active sessions)
- `app/api/evolve/local/**` (depend on the singleton)
- `components/EvolveForm.tsx` (editing mid-session orphans the session)
- `next.config.ts`, `postcss.config.mjs`, `package.json`, `bun.lock`, `.env.local`, `.env`, `.github/workflows`

If Claude tries to touch one of these files in live mode, the tool call is blocked and Claude is told to switch to worktree mode instead.

### Files changed

- `PRIMORDIA.md` — new "Live Edit Safety" section with rubric tables
- `lib/local-evolve-sessions.ts` — `mode` field on `LocalSession`, `LIVE_EDIT_BLOCKED_PATHS`, `makeLiveEditSafetyHook()`, `startLiveEdit()`
- `app/api/evolve/local/route.ts` — `mode` param in POST, branch guard, routes to `startLiveEdit` or `startLocalEvolve`
- `app/api/evolve/local/manage/route.ts` — live mode accept (git commit) and reject (git restore + clean), body parsed before preview guard
- `app/evolve/page.tsx` — passes `currentBranch` to `EvolveForm`
- `components/EvolveForm.tsx` — mode toggle, live Accept/Reject bar, inline ready message
