# Add onboarding tour script

Added `docs/admin-onboarding-tour-script.md` — a step-by-step script for a product tour shown to any user the first time they land on the home page with the `can_evolve` role. Admin-specific steps appear at the end, gated on the `admin` role.

## What's in the script

- 22 steps across 6 acts: welcome, home page orientation, credentials setup (3 options), evolve flow walkthrough, admin tools (optional/admin-only), and wrap-up.
- Each step specifies: anchor URL + element to highlight, tooltip copy (with admin/non-admin variants where needed), the user action that advances the tour, and the analytics event to fire.
- Credentials act (Act 3) is anchored to the real `/settings` page: Step 6 highlights the priority badge (Claude.ai › Anthropic API key › exe.dev gateway) to explain the cascade; Step 7 covers exe.dev zero-config (skip if not on exe.dev); Step 8 highlights the OpenRouter card (`sk-or-v1-…`, "Get a key" link); Step 9 switches to `/settings/claude-ai` and highlights the "Sign in with Claude.ai" OAuth button, with a note about the manual credentials.json paste fallback for Linux.
- Evolve act walks through the form, attachments/inspector, submit flow, and session page — without requiring the user to actually submit during the tour.
- Admin act (Steps 17–21) is skipped entirely for non-admin users.
- Skip/dismiss path with DB flag to suppress re-trigger on future logins.
- Open questions section listing unresolved design decisions to resolve before building.

## Why

We want to orient new users (not just first admins) as soon as they gain evolve access — covering credentials first so they understand their AI options before trying to propose a change.
