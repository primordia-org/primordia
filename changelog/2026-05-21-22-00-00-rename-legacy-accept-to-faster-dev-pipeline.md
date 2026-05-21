# Rename Legacy Dev Accept Pipeline to Faster Development Pipeline

## Description
Renamed the direct merge/accept flow (active when `NODE_ENV !== 'production'`) from the confusing "legacy development environment accept pipeline" to the "faster development pipeline" across the codebase. 

As noted, the only truly "legacy" context is the original Vercel + GitHub Pull Requests + Claude GitHub Action flow. Merging a non-production branch into another non-production branch represents a much faster, lighter flow that simply skips full production building and typechecking.

This is NOT a "local dev" vs "production server" distinction—both flows are orthogonal to where they run. Rather, there is a promoting-to-prod slot path (usually production environment deploys) and a merging-a-dev-branch fast path (merging non-prod branches directly, usually mapped via `NODE_ENV !== 'production'`).

Also retroactively updated the previous changelog file `changelog/2026-05-21-21-00-00-fix-merging-pipeline-newlines.md` to reference the correct "faster development pipeline" terminology.

## Changes Made
- Updated comments and documentation pointers in `app/api/evolve/manage/route.ts` to refer to this flow as the "faster dev pipeline" instead of "legacy / legacy path", and removed outdated/incorrect "local dev" distinctions.
- Updated `app/api/evolve/CLAUDE.md` to reflect the name change and remove inaccurate "local dev" references.
- Retroactively corrected references in `changelog/2026-05-21-21-00-00-fix-merging-pipeline-newlines.md`.
