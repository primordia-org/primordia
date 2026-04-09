# Add admin proxy logs viewer page

## What changed

- Added `app/admin/proxy-logs/page.tsx` — a new admin page that streams the `primordia-proxy` systemd service journal in real time, protected by the admin role check (shows `ForbiddenPage` for non-admins).
- Added `app/api/admin/proxy-logs/route.ts` — a new SSE API route that runs `journalctl -u primordia-proxy -f -n 100` and streams output to the client, identical in structure to the existing `/api/admin/logs` route.
- Updated `components/ServerLogsClient.tsx` — added an optional `apiPath` prop (defaults to `/api/admin/logs`) so the same component can be reused for both the primordia and primordia-proxy journals without duplication.
- Updated `components/AdminSubNav.tsx` — added a "Proxy Logs" tab pointing to `/admin/proxy-logs`, alongside the existing Server Logs and Rollback tabs.
- Updated `PRIMORDIA.md` — documented the new page, API route, and tab in the file map, component list, and features table.

## Why

The `primordia-proxy` reverse proxy (which handles zero-downtime blue/green routing and preview server traffic) is a separate systemd service from the main `primordia` app. Its logs were previously only accessible via SSH. This page surfaces them directly in the admin panel alongside the existing server logs view, making it easier to diagnose proxy routing issues, port assignment problems, and service startup failures.
