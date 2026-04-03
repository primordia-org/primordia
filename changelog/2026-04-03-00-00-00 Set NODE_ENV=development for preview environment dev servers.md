# Set NODE_ENV=development for preview environment dev servers

## What changed

Both `bun run dev` spawn calls in `lib/evolve-sessions.ts` now explicitly pass `NODE_ENV: 'development'` in the environment passed to the child process:

- The initial dev server spawn (after Claude finishes the worktree).
- The restart dev server spawn (via `POST /api/evolve/kill-restart`).

## Why

Preview worktrees inherit the parent process environment. In production, `NODE_ENV` is not set to `development` in the parent process, so the spawned Next.js dev servers were not getting the expected development-mode behaviour (e.g. hot reload, detailed error overlays, unminified output). Explicitly setting `NODE_ENV: 'development'` ensures preview environments always run in development mode regardless of what environment the main Primordia process was started in.
