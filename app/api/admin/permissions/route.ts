// app/api/admin/permissions/route.ts
// Admin-only API to grant or revoke user roles.
//
// POST { userId, role, action: "grant" | "revoke" }
//   → 200 { ok: true }
//   → 401 if not authenticated
//   → 403 if not admin
//   → 400 if missing/invalid params

import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

// Roles that admins are allowed to grant/revoke via this API.
// "admin" is excluded — it is bootstrapped automatically and cannot be delegated.
const GRANTABLE_ROLES = ["can_evolve"];

/** JSON body for POST /admin/permissions */
export interface AdminPermissionsBody {
  userId: string; // UUID of the user to modify.
  role: 'can_evolve'; // The role to grant or revoke. Only 'can_evolve' is supported via this API.
  action: 'grant' | 'revoke'; // Whether to grant or revoke the role.
}

/**
 * Grant or revoke a user role
 * @description Grants or revokes a grantable role for a user. The `admin` role cannot be managed via this endpoint. Admin only.
 * @tags Admin
 * @body AdminPermissionsBody
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!(await isAdmin(user.id))) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = (await request.json()) as {
    userId?: string;
    role?: string;
    action?: string;
  };

  if (!body.userId || !body.role || !body.action) {
    return Response.json({ error: "userId, role, and action required" }, { status: 400 });
  }

  if (body.action !== "grant" && body.action !== "revoke") {
    return Response.json({ error: 'action must be "grant" or "revoke"' }, { status: 400 });
  }

  if (!GRANTABLE_ROLES.includes(body.role)) {
    return Response.json(
      { error: `role must be one of: ${GRANTABLE_ROLES.join(", ")}` },
      { status: 400 }
    );
  }

  const db = await getDb();

  if (body.action === "grant") {
    await db.grantRole(body.userId, body.role, user.id);
  } else {
    await db.revokeRole(body.userId, body.role);
  }

  return Response.json({ ok: true });
}
