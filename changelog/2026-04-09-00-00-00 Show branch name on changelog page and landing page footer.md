# Show branch name on all nav-header pages and landing page footer

## What changed

- **All pages with the shared nav header** (`/changelog`, `/branches`, `/admin`, `/admin/logs`, `/admin/rollback`, `/oops`): the current git branch name is now shown in parentheses next to "Primordia" in the nav header, matching the existing behaviour on the chat page.
- **Landing page** (`/`): the current git branch name is now baked into the footer at render time, appearing in a muted colour next to "Primordia — a self-modifying web application".

## Why

Every page using `PageNavBar` now surfaces the current branch so there is a consistent visual cue across the whole app. On `main` this is usually invisible, but on preview/session worktrees it makes it immediately clear which branch you are looking at — especially useful when reviewing evolve sessions side-by-side.

The landing page uses a static render-time value (no client JS) so it adds zero JavaScript weight to the page.
