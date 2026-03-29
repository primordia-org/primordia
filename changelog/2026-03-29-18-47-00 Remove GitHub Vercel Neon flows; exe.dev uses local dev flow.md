# Remove GitHub, Vercel, and Neon flows; exe.dev uses local dev flow

## What changed

exe.dev runs `bun run dev` (`NODE_ENV=development`), making it identical to local development. All code exclusive to the GitHub Issues → GitHub Actions CI → Vercel deploy preview flow has been removed, Vercel env var references cleaned up, and env var documentation corrected.

### Deleted files

- **`app/api/evolve/route.ts`** — created GitHub Issues to trigger the CI pipeline; no longer needed
- **`app/api/evolve/status/route.ts`** — polled GitHub for CI progress and Vercel preview URLs; no longer needed
- **`app/api/deploy-context/route.ts`** — fetched PR + linked issue info from Vercel's injected env vars; no longer needed
- **`app/api/merge-pr/route.ts`** — merged GitHub PRs from Vercel deploy previews; no longer needed
- **`app/api/close-pr/route.ts`** — closed GitHub PRs from Vercel deploy previews; no longer needed
- **`lib/db/neon.ts`** — Neon PostgreSQL adapter used in Vercel production; exe.dev uses SQLite like local dev
- **`.github/workflows/evolve.yml`** — GitHub Actions CI pipeline (issue → Claude Code → PR)
- **`.github/workflows/ci.yml`** — GitHub Actions type-check/lint on PRs

### Modified files

- **`lib/db/index.ts`** — removed `DATABASE_URL` / Neon branch; always uses SQLite
- **`next.config.ts`** — removed `VERCEL_ENV`, `VERCEL_GIT_*`, `VERCEL_PROJECT_PRODUCTION_URL` env var forwarding
- **`components/NavHeader.tsx`** — removed Vercel PR link (was shown in preview deployments)
- **`components/AcceptRejectBar.tsx`** — removed Vercel deploy preview accept/reject section; kept local preview bar unchanged
- **`components/EvolveForm.tsx`** — removed GitHub evolve flow; `handleSubmit` now always calls the local evolve flow directly
- **`components/ChatInterface.tsx`** — removed `deployContext` state, the `VERCEL_ENV === "preview"` useEffect (which called the now-deleted `/api/deploy-context` route), and the `systemContext` field from the `/api/chat` request body
- **`app/api/check-keys/route.ts`** — removed `GITHUB_TOKEN` / `GITHUB_REPO` from the missing-keys check (only required in the old production GitHub flow)
- **`app/chat/page.tsx`** and **`app/evolve/page.tsx`** — removed `process.env.VERCEL_GIT_COMMIT_REF ??` prefix; branch is always read from git directly
- **`lib/page-title.ts`** — removed `VERCEL_GIT_COMMIT_REF` early-return; `getCurrentBranch()` now only uses `git rev-parse --abbrev-ref HEAD`
- **`.env.example`** — removed `GITHUB_TOKEN`, `GITHUB_REPO`, `EVOLVE_LABEL`, `DATABASE_URL` required entries; added `GITHUB_TOKEN` and `GITHUB_REPO` as optional commented-out entries (still used by `app/api/git-sync/route.ts`)
- **`package.json`** — removed `@neondatabase/serverless` dependency
- **`PRIMORDIA.md`** — updated architecture docs: tech stack, file map, data flow, env vars, setup checklist, features table; added `GITHUB_TOKEN` and `GITHUB_REPO` to the env vars table

## Why

exe.dev runs the app with `bun run dev` (`NODE_ENV=development`), so it has always used the local evolve flow (git worktrees + Claude Agent SDK) and SQLite for auth storage — exactly like local development. The GitHub/Vercel/Neon code paths were dead code on exe.dev. Removing them simplifies the codebase significantly: fewer API routes, fewer env vars to configure, and a single evolve flow to reason about.

`GITHUB_TOKEN` and `GITHUB_REPO` are retained as optional env vars because `app/api/git-sync/route.ts` (the GitSyncDialog) still uses them to build an authenticated remote URL for git pull/push. They are optional — the route falls back to the `origin` remote if absent.
