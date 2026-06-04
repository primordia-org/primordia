# Auth — Architecture Reference

This file covers the auth subsystem: the API routes under `app/api/auth/`, the RBAC model, and the pluggable auth-provider pattern.

---

## RBAC (Roles and Permissions)

Primordia uses a simple role-based access control system stored in SQLite.

**Roles** (seeded at boot, stored in the `roles` table):

| Role (internal name) | Default display name | Description |
|---|---|---|
| `admin` | Prime | Full system access. Automatically granted to the first user who registers. Cannot be granted via the API. |
| `can_evolve` | Evolver | Allows the user to access `/evolve` and submit change requests to Claude Code. Granted/revoked by admins via `/admin`. |

**Tables:**
- `roles` — catalog of all roles (name, id UUID, display_name, description, created_at). `name` is the immutable internal slug used in code and FK references; `display_name` is a customizable human-readable label shown in the UI.
- `user_roles` — maps users to roles (user_id, role_name, granted_by, granted_at)

**Key auth helpers in `lib/auth.ts`:**
- `isAdmin(userId)` — true if user has the `admin` role
- `hasEvolvePermission(userId)` — true if user has `admin` or `can_evolve` role

**Bootstrap:** The first user to register (via passkey or exe.dev login) is automatically granted the `admin` role. On DB startup, any existing first user without the role is backfilled. The `admin` role cannot be granted or revoked via the API — only via direct DB access.

---

## Auth Provider Plugin Pattern

Auth providers live in `lib/auth-providers/`. Enabled providers and their display order are controlled by `lib/auth-providers/registry.ts` (`ENABLED_PROVIDERS`), which is import-safe for middleware/Edge runtime checks. Each provider directory exports a default descriptor object (`AuthPlugin`) and a corresponding client-side tab component in `components/auth-tabs/`.

To add a new provider: create `lib/auth-providers/{name}/index.ts` (server descriptor), `components/auth-tabs/{name}/index.tsx` (client tab), add the provider id to `ENABLED_PROVIDERS`, then wire the id into the server plugin map in `app/login/page.tsx` and the tab map in `app/login/LoginClient.tsx`. Add any API routes under `app/api/auth/{name}/` as needed.
