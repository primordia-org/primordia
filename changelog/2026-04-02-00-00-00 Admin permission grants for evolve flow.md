# Admin permission grants for evolve flow

## What changed

- **Owner/admin concept**: The first user ever registered in the database is now the permanent owner with full admin privileges. This is determined at runtime by selecting the user with the earliest `created_at` timestamp — no extra column required.

- **`can_evolve` permission**: Access to the evolve flow (proposing changes) is now restricted. A new `user_permissions` table in SQLite stores explicit grants. The admin always has evolve access; all other users need to be granted `can_evolve` by the admin.

- **`/admin` page**: A new admin-only page at `/admin` lists all registered users, shows their role (owner vs. user) and current evolve access, and provides Grant / Revoke buttons. Non-admin users are redirected to `/chat`.

- **`POST /api/admin/permissions`**: New API route that accepts `{ userId, permission, action: "grant" | "revoke" }`. Requires the caller to be admin (403 otherwise).

- **Evolve restrictions enforced**: `app/evolve/page.tsx` redirects users without evolve permission to `/chat`. `POST /api/evolve` returns HTTP 403 for users without evolve permission.

- **DB layer additions**: `DbAdapter` gains `getAllUsers`, `getFirstUser`, `grantPermission`, `revokePermission`, `getUserPermissions`, `getUsersWithPermission`. SQLite adapter adds the `user_permissions` table (`CREATE TABLE IF NOT EXISTS`, so existing databases upgrade automatically on next boot).

- **Auth helpers**: `lib/auth.ts` gains `isAdmin(userId)` and `hasEvolvePermission(userId)` for use in server components and API routes.

## Why

Previously, any logged-in user could access the evolve flow and trigger Claude Code to run. This opens the door to abuse when multiple users share the same Primordia instance. The owner (first user) now controls who may propose changes, keeping the self-modification flow restricted to trusted collaborators.
