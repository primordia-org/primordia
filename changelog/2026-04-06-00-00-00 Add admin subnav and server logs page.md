# Add admin subnav and server logs page

## What changed

- **Admin subnav** (`components/AdminSubNav.tsx`): Added a tab-style subnav to the admin section with two tabs — "Manage Users" (`/admin`) and "Server Logs" (`/admin/logs`). Both admin pages now render this subnav below the `PageNavBar`.

- **Server Logs page** (`app/admin/logs/page.tsx`): New admin-only page that displays live output from the `primordia` systemd service journal. Applies the same auth check as the existing `/admin` page (admin role required; renders `ForbiddenPage` for non-admins).

- **Server Logs client** (`components/ServerLogsClient.tsx`): Client component that opens a long-lived SSE connection to `GET /api/admin/logs` on mount, appending streamed log lines to a scrollable terminal window. Features: live/disconnected status indicator, auto-scroll that pauses when the user scrolls up (with a "Resume scroll" prompt), Clear button, and a Reconnect button when the stream ends.

- **Logs API route** (`app/api/admin/logs/route.ts`): `GET /api/admin/logs` — admin-only SSE endpoint that spawns `journalctl -u primordia -f -n 100` and streams stdout/stderr. Kills the process when the client disconnects.

## Why

The admin page previously had a single flat layout with no way to navigate between admin tools. Adding a subnav creates a natural home for new admin features. The server logs page lets admins tail the running service directly in the browser without needing SSH access.
