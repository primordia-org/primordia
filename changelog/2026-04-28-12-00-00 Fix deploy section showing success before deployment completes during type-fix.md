# Fix deploy section showing success before deployment completes during type-fix

## What changed

When accepting a session triggered an auto-fix pass (TypeScript errors found during the accept pipeline), the deploy section in the session UI was incorrectly showing "🚀 Deployed to production" before the deployment had actually happened. Additionally, the post-fix deployment logs (re-typecheck, build, install.sh output) were invisible because they were grouped into the `type_fix` section in the NDJSON rather than the deploy section.

### Changes

**`app/api/evolve/manage/route.ts`** — `retryAcceptAfterFix`:
- Now emits a new `section_start: deploy` event before re-checking TypeScript types and running install.sh. This creates a fresh deploy section in the NDJSON that captures all post-fix deployment steps (re-typecheck, build, install.sh output, and the `decision: accepted` event). Previously those events were all appended to the `type_fix` section, making them invisible in the deploy UI.

**`app/evolve/session/[id]/EvolveSessionView.tsx`** — deploy section renderer:
- Deploy success now requires a `decision: accepted` event to be present in the section's events, not just the absence of an error. Previously, any deploy section that was not active and had no error result would incorrectly render as "🚀 Deployed to production".
- Added a "paused — fixing type errors" neutral state for deploy sections that were interrupted mid-pipeline (no decision event, no error, not active). These are the initial typecheck-only deploy sections that occur when type errors are found and trigger a fix pass.

## Why

The root cause was a two-part bug:
1. The deploy section renderer used "no error" as a proxy for success, so a section with no result event at all (interrupted by a type_fix section starting) would render as successful.
2. `retryAcceptAfterFix` appended its log lines and the `decision: accepted` event without starting a new deploy section, so all post-fix deployment output landed inside the type_fix section and was hidden.

Now the session UI correctly shows:
- First deploy section: "paused — fixing type errors" (gray, partial log with initial typecheck)
- Type_fix section: "🔧 Type errors fixed"
- Second deploy section: "🚀 Deployed to production" with full logs (re-typecheck, build, install.sh output)
