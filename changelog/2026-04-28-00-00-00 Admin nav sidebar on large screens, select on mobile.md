# Admin nav: sidebar on large screens, select on mobile

## What changed

Replaced the crowded horizontal tab bar in the admin section with a responsive navigation pattern:

- **Large screens (lg+):** A sticky vertical sidebar on the left lists all admin sections as link items. The active item is highlighted with a filled pill style (`bg-gray-700 text-white`). The sidebar is `w-44` and uses `sticky top-6` so it stays visible while scrolling long pages.
- **Mobile:** A full-width `<select>` dropdown at the top of the page lists all sections. Changing the selection navigates immediately via `router.push()`.

All 8 admin pages (`/admin`, `/admin/logs`, `/admin/proxy-logs`, `/admin/rollback`, `/admin/server-health`, `/admin/git-mirror`, `/admin/updates`, `/admin/instance`) were updated to:
- Widen from `max-w-3xl` to `max-w-5xl` to accommodate the sidebar column.
- Wrap the `<AdminSubNav>` + page content in a `flex flex-col lg:flex-row` container, giving the content area `flex-1 min-w-0` so it takes all remaining space.

`AdminSubNav` is now a client component (`"use client"`) to support the `useRouter` call needed for the select's `onChange` handler.

## Why

The admin nav had 8 items crammed into a single row of tabs, which wrapped or overflowed on most screen sizes. A sidebar uses the extra horizontal space available on larger screens without sacrificing usability on mobile.
