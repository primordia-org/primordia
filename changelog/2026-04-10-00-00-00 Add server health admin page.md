# Add server health admin page

## What changed

- Added `/admin/server-health` page (admin-only) with a new "Server Health" tab in the admin subnav.
- The page shows:
  - **Disk space**: total, used, and available bytes read from `df -B1 /`, displayed as a labelled progress bar that turns amber at 70% and red at 90% used.
  - **Memory**: total, used, and available MB read from `/proc/meminfo`, displayed the same way.
  - **Worktree cleanup**: shows the oldest non-prod worktree (any registered git worktree that is neither the main worktree nor the current production branch) with a "Delete oldest" button.
- The "Delete oldest" button (POST `/api/admin/server-health`):
  1. Kills the dev server on the worktree's assigned port (via `lsof` + `SIGTERM`).
  2. Removes the worktree with `git worktree remove --force`.
  3. Deletes the branch with `git branch -D`.
  4. Cleans up the branch port entry in git config.
- New files:
  - `app/api/admin/server-health/route.ts` — GET (health info) and POST (delete oldest worktree).
  - `app/admin/server-health/page.tsx` — server component shell with auth + forbidden page.
  - `components/AdminServerHealthClient.tsx` — client component with usage bars and delete button.
- Updated `components/AdminSubNav.tsx` to include the new "Server Health" tab.
- Fixed the admin subnav tabs overflowing on narrow screens: added `overflow-x-auto` so the tab row scrolls horizontally, `shrink-0` on each tab so they don't compress, and `max-w-full` on the nav so it spans the page.
- Removed `max-w-3xl` from all admin page `<main>` containers so the pages use full screen width, consistent with the nav bar spanning the full width.

## Why

Old non-prod worktrees accumulate on disk after evolve sessions are accepted or abandoned — there was no way to monitor or clean them up without SSH access. This page gives admins visibility into resource usage and a one-click path to reclaim disk space.
