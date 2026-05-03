# Admin updates bell notification

## What changed

- Added a new API endpoint `GET /api/admin/updates/has-updates` that efficiently checks whether any configured update source has new commits available (ahead of `main`). Returns `{ hasUpdates: boolean }`. Admin-only.
- Added a new `AdminUpdatesBell` client component (`components/AdminUpdatesBell.tsx`) that fetches the new endpoint on mount and renders an animated amber bell icon (linking to `/admin/updates`) when updates are available. Silently hidden on errors or when no updates exist.
- Modified `HamburgerMenu` to embed `AdminUpdatesBell` to the left of the hamburger toggle button. Since every nav bar in the app renders `HamburgerMenu`, this propagates the bell to all pages (landing, changelog, branches, admin, evolve, session view) without needing per-page changes.

## Why

Admins had no way to know updates were available without manually visiting `/admin/updates`. The bell gives a persistent, low-friction signal anywhere in the app.
