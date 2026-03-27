# Add local branches tree page

## What changed

- **New page `/branches`** — a client-side React component that displays all local git branches as an ASCII tree rooted at `main`. Auto-refreshes every 3 seconds.
- **New API route `GET /api/branches`** — returns the full list of local branches with:
  - `isCurrent` — whether the branch is currently checked out in the main repo
  - `parent` — the parent branch from `git config branch.<name>.parent` (set by the local evolve flow)
  - `previewUrl` and `sessionStatus` — read from the in-memory `sessions` singleton in `lib/local-evolve-sessions.ts`
  - `mainServerUrl` — the URL of the main dev server derived from the request's `Host` header
- **`NavHeader` updated** — adds a "Branches" link in the subtitle bar, visible only in `NODE_ENV=development`.

## Why

When several local evolve sessions are running simultaneously it was hard to track which branch had which preview server. The new `/branches` page gives a single glanceable view: every branch in a tree, with `http://localhost:PORT ↗` links for any branch whose session is active. Branches without a live session still appear in the tree but without a link.

The page is development-only (the API returns `403` in production) and does not require authentication, matching the existing `/changelog` page.
