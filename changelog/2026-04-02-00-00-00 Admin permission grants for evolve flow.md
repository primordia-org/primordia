# Admin permission grants, RBAC roles, and 403 access-denied pages

## What changed

### RBAC (role-based access control)

Replaced the flat `user_permissions` table with a proper (but simple) RBAC system:

- **`roles` table** — catalog of named roles with descriptions. Seeded at boot with two built-in roles:
  - `admin` (display name: **Prime**) — full system access; automatically granted to the first user who registers
  - `can_evolve` (display name: **Evolver**) — allows a user to submit change requests via the evolve flow

  Each role has a stable UUID (`id`) and a customizable `display_name`. The internal `name` slug is immutable and used in code/FK references; `display_name` is the human-readable label shown in the UI and can be renamed without breaking role assignments.

- **`user_roles` table** — maps users to roles (`user_id`, `role_name`, `granted_by`, `granted_at`). Replaces the old `user_permissions` table; existing `user_permissions` rows are automatically migrated on first boot.

- **Bootstrap** — the first user to register (passkey or exe.dev) is granted the `admin` role immediately. On DB startup, any pre-existing first user without the role is backfilled.

- **Auth helpers updated** — `isAdmin(userId)` now checks for the `admin` role (previously checked first-user by `created_at`). `hasEvolvePermission(userId)` checks for `admin` or `can_evolve` role.

- **Admin API updated** — `POST /api/admin/permissions` now accepts `{ userId, role, action }` instead of `{ userId, permission, action }`. Only grantable roles (`can_evolve`) are accepted; `admin` cannot be delegated via the API.

### 403 access-denied pages (best practice)

Protected routes no longer silently redirect to `/chat` when a logged-in user lacks permissions. Instead they render `<ForbiddenPage>`, which shows:

1. A brief description of what the page does (so the user knows if they even want access)
2. The full list of conditions required to access the page
3. Which conditions the user currently meets (green ✓) and doesn't meet (red ✗)
4. How to gain the missing access

This pattern is documented in PRIMORDIA.md as a design principle: unauthenticated users (no session) are still redirected to `/login`; authenticated users lacking a role see the 403 page.

- `components/ForbiddenPage.tsx` — new reusable server component
- `app/evolve/page.tsx` — renders ForbiddenPage for users without `admin` or `can_evolve` role; role names in the message are read from the DB so they reflect any customized `display_name`
- `app/admin/page.tsx` — renders ForbiddenPage for users without `admin` role; role names in the message are read from the DB so they reflect any customized `display_name`

### Admin link in hamburger menu

The hamburger menu (☰) in the header now shows an **Admin** link for users who have the `admin` role. The link is hidden for non-admin users. It appears on all pages that use the hamburger menu: chat, evolve form, evolve session, changelog, branches, and **the admin page itself**.

The admin page (`/admin`) now uses `PageNavBar` for its header, giving it the same hamburger menu as other pages. The Admin link is suppressed in the dropdown when already on the admin page (via a new `excludeAdmin` option in `buildStandardMenuItems`).

### DRY: shared menu item helper

The four standard hamburger items (Go to chat, Propose a change, Sync with GitHub, Admin) were duplicated verbatim across four components (`ChatInterface`, `EvolveForm`, `EvolveSessionView`, `PageNavBar`). Extracted into a single `buildStandardMenuItems({ onSyncClick, isAdmin, excludeAdmin? })` helper exported from `HamburgerMenu.tsx`. All four components now call this helper instead of inlining the item arrays.

To support this, `SessionUser` (the client-side session type returned by `/api/auth/session`) now includes an `isAdmin: boolean` field so client components can conditionally render admin-only UI without a separate API call.

### Fix: roles seed inserts failed on existing databases

On databases created before the `id` and `display_name` columns were added to the `roles` table, startup crashed with `SQLiteError: table roles has no column named id`. The column migrations (`ALTER TABLE roles ADD COLUMN id/display_name`) were running **after** the seed `INSERT OR IGNORE` statements that reference those columns. Fixed by reordering: column migrations now run before the seed inserts.

## Why

The flat `user_permissions` approach worked for a single permission but didn't scale cleanly to multiple access levels. A roles table is the standard pattern and makes the system easier to extend (e.g., adding a `can_chat` role later). The silent redirect to `/chat` was also confusing — users had no idea why they were bounced or what they'd need to do to get access.
