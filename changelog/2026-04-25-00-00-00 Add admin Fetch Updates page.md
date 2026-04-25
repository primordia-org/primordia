# Add admin "Fetch Updates" page

## What changed

Added a new **Fetch Updates** tab to the admin panel at `/admin/updates`.

### New files
- `app/admin/updates/page.tsx` — Server-rendered admin page (auth-gated to admins).
- `app/admin/updates/UpdatesClient.tsx` — Client component with the interactive UI.
- `app/api/admin/updates/route.ts` — API route handling three operations:
  - `GET` — returns current update state (remote configured, ahead commit count, new changelog entries).
  - `POST { action: "fetch" }` — adds the `primordia-updates` remote pointing at `https://primordia.exe.xyz/api/git` (if not already present) and fetches the upstream `main` branch into a local tracking branch called `primordia-updates-main`.
  - `POST { action: "create-session" }` — creates an evolve session on a new branch from local `main` with a pre-written merge prompt instructing Claude to merge `primordia-updates-main`, resolve conflicts, and verify the build.

### Modified files
- `components/AdminSubNav.tsx` — Added **Fetch Updates** tab between Git Mirror and Instance.

## How it works

1. Admin visits `/admin/updates`.
2. Clicks **Fetch Updates** — the server adds (or reuses) the `primordia-updates` remote and fetches `main` → `primordia-updates-main`.
3. The page displays how many commits are ahead and shows a collapsible list of new `changelog/*.md` entries added since the local `main` diverged (via `git merge-base`).
4. If there are updates, **Create Merge Session** becomes available. Clicking it creates a new branch from `main`, starts an evolve session, and redirects the admin to the session page. Claude merges `primordia-updates-main`, resolves any conflicts, and verifies the build. The admin can then preview the result and accept or reject as usual.

## Why

Primordia instances can diverge from the upstream `primordia.exe.xyz` instance over time. This page gives admins a zero-CLI path to pull in upstream improvements and review them through the normal evolve/accept workflow.
