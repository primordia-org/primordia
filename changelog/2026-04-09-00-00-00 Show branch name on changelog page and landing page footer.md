# Show branch name on changelog page and landing page footer

## What changed

- **Changelog page** (`/changelog`): the current git branch name is now shown in parentheses next to "Primordia" in the nav header, matching the existing behaviour on the chat page.
- **Landing page** (`/`): the current git branch name is now baked into the footer at render time, appearing in a muted colour next to "Primordia — a self-modifying web application".

## Why

These two surfaces were the only pages that didn't surface the branch name. On `main` the branch name is usually hidden because prod reads cleanly, but on preview/session worktrees it provides an instant visual cue of which branch you are looking at — especially useful when reviewing evolve sessions side-by-side.

The landing page uses a static render-time value (no client JS) so it adds zero JavaScript weight to the page.
