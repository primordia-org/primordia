# Add Playwright E2E tests for the evolve demo flow

Adds a Playwright test suite that faithfully executes the demo script in `docs/evolve-demo-script.md`. The test walks through all six acts: opening the floating evolve dialog from the hamburger menu, attaching files, picking elements, toggling advanced options, submitting, watching Claude run, reviewing the diff, submitting a follow-up, and clicking Accept.

**Why:** The demo script is the source of truth for which user events the app emits during a typical evolve session. An automated test pinned to that script:

- Catches regressions where a UI change silently drops a `data-id` attribute or breaks an event call site.
- Doubles as a smoke test for the full local evolve pipeline (worktree creation, agent run, deploy).
- Gives us a recorded run we can replay when iterating on the demo video.

## What's added

- `tests/evolve-demo.spec.ts` — main test, broken into Acts 1–6 mirroring the demo doc, with named timeout constants and graceful skips for steps that require infrastructure not present in plain `bun run dev` (the reverse proxy preview, accept gating).
- `tests/global-setup.ts` — provisions a logged-in admin session via the exe-dev SSO route (which trusts the `x-exedev-email` header in local dev), then provisions the user's Anthropic API key by mirroring `lib/api-key-client.ts`'s AES-GCM encryption flow.
- `playwright.config.ts` — single Chromium project, `globalSetup` wired up, `storageState` reused across tests, 20-minute test timeout to accommodate two Claude passes plus deploy.
- `package.json` — adds `@playwright/test` dev dep and `test:e2e` / `test:e2e:headed` scripts.
- `.gitignore` — excludes Playwright auth state, temp attachments, and result/report directories.
