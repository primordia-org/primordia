# Show git branch and commit in UI

## What changed

- Added `/api/git-context` — a new server route that returns the current git branch name and HEAD commit message. Uses `VERCEL_GIT_COMMIT_REF` / `VERCEL_GIT_COMMIT_MESSAGE` on Vercel deployments; falls back to `git branch --show-current` and `git log -1 --pretty=%s` in local dev and git worktrees.
- The page title (browser tab) now reads **Primordia (branch-name)** — updated client-side via `document.title` after the git context is fetched.
- The h1 header now shows the branch name in parentheses after "Primordia" (e.g. `Primordia (evolve/my-feature)`), rendered in muted gray so it's visible but unobtrusive.
- On load, Primordia injects an assistant message: _"Ok, here's what's changed: {commit subject}"_ — giving instant context about what build you're looking at without any extra clicks.

## Why

When reviewing local worktree previews (or Vercel deploy previews), it was impossible to tell at a glance which branch/change you were looking at. This makes the tab title and the chat self-describing, so you always know exactly what build is open.
