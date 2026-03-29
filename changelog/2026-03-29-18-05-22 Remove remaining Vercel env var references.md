## Remove remaining Vercel environment variable references

### What changed

- **`lib/page-title.ts`** — removed `VERCEL_GIT_COMMIT_REF` branch; `getCurrentBranch()` now only uses `git rev-parse --abbrev-ref HEAD`.
- **`app/chat/page.tsx`** — removed `process.env.VERCEL_GIT_COMMIT_REF ??` prefix; branch is always read from git directly.
- **`app/evolve/page.tsx`** — same as above.
- **`components/ChatInterface.tsx`** — removed the `deployContext` state, the `VERCEL_ENV === "preview"` useEffect (which called the now-deleted `/api/deploy-context` route), and the `systemContext` field from the `/api/chat` request body.

### Why

The PR `exe-dev-flow-consolidation` removed all Vercel-specific infrastructure (deploy previews, Neon DB, GitHub Actions CI). These residual `VERCEL_GIT_COMMIT_REF` and `VERCEL_ENV` references were left behind. Since exe.dev runs `bun run dev` (local dev mode), git is always available and these env vars are never set — making the fallback paths the only paths that ever run. Removing the dead Vercel branches keeps the code straightforward.
