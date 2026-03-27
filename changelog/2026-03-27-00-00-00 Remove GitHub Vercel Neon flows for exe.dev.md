# Remove GitHub, Vercel, and Neon flows for exe.dev

## What changed

The production environment is now exe.dev, which runs `bun run dev` (i.e. `NODE_ENV=development`) — identical to local development. All code that existed exclusively to support the GitHub Issues → GitHub Actions CI → Vercel deploy preview flow has been removed.

### Deleted files

- **`app/api/evolve/route.ts`** — created GitHub Issues to trigger the CI pipeline; no longer needed
- **`app/api/evolve/status/route.ts`** — polled GitHub for CI progress and Vercel preview URLs; no longer needed
- **`app/api/deploy-context/route.ts`** — fetched PR + linked issue info from Vercel's inject env vars; no longer needed
- **`app/api/merge-pr/route.ts`** — merged GitHub PRs from Vercel deploy previews; no longer needed
- **`app/api/close-pr/route.ts`** — closed GitHub PRs from Vercel deploy previews; no longer needed
- **`lib/db/neon.ts`** — Neon PostgreSQL adapter used in Vercel production; exe.dev uses SQLite like local dev
- **`.github/workflows/evolve.yml`** — GitHub Actions CI pipeline (issue → Claude Code → PR)
- **`.github/workflows/ci.yml`** — GitHub Actions type-check/lint on PRs

### Modified files

- **`lib/db/index.ts`** — removed `DATABASE_URL` / Neon branch; always uses SQLite
- **`next.config.ts`** — removed `VERCEL_ENV`, `VERCEL_GIT_*`, `VERCEL_PROJECT_PRODUCTION_URL` env var forwarding
- **`components/NavHeader.tsx`** — removed Vercel PR link (was shown in preview deployments)
- **`components/AcceptRejectBar.tsx`** — removed Vercel deploy preview accept/reject section (deploy-context fetch, merge-pr/close-pr calls); kept local preview bar unchanged
- **`components/EvolveForm.tsx`** — removed GitHub evolve flow (`handleEvolveSubmit`, `handleEvolveComment`, `handleEvolveCreate`, `performEvolveCreate`, `startEvolvePolling`), removed `deployPrBranch` state and deploy-context fetch; `handleSubmit` now always calls the local evolve flow directly
- **`app/api/check-keys/route.ts`** — removed `GITHUB_TOKEN` / `GITHUB_REPO` from the missing-keys check (they were only required in the old production GitHub flow)
- **`.env.example`** — removed `GITHUB_TOKEN`, `GITHUB_REPO`, `EVOLVE_LABEL`, `DATABASE_URL`; only `ANTHROPIC_API_KEY` is required
- **`package.json`** — removed `@neondatabase/serverless` dependency
- **`PRIMORDIA.md`** — updated architecture docs: tech stack, file map, data flow, env vars, setup checklist, features table

## Why

exe.dev runs the app with `bun run dev` (`NODE_ENV=development`), so it has always used the local evolve flow (git worktrees + Claude Agent SDK) and SQLite for auth storage — exactly like local development. The GitHub/Vercel/Neon code paths were dead code on exe.dev. Removing them simplifies the codebase significantly: fewer API routes, fewer env vars to configure, and a single evolve flow to reason about.
