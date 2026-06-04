# Run bun install after Apply Updates

Apply Updates now treats the post-merge dependency install as a required step. After merging the parent branch into an evolve session branch, the server runs `bun install` in the session worktree and returns an error if dependency installation fails.

This ensures merged package or lockfile changes are installed before the preview database is refreshed and the session continues, avoiding stale dependencies after upstream updates are applied.

Follow-up documentation updates refreshed the path-scoped file maps for app pages/components, API routes, shared libraries, scripts, and auth/evolve architecture notes so future agents have accurate guidance for the current tree.
