// app/api/admin/permissions/route.ts
// Admin-only API to grant or revoke user permissions.
//
// POST { userId, permission, action: "grant" | "revoke" }
//   → 200 { ok: true }
//   → 401 if not authenticated
//   → 403 if not admin
//   → 400 if missing/invalid params

import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

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
    permission?: string;
    action?: string;
  };

  if (!body.userId || !body.permission || !body.action) {
    return Response.json({ error: "userId, permission, and action required" }, { status: 400 });
  }

  if (body.action !== "grant" && body.action !== "revoke") {
    return Response.json({ error: 'action must be "grant" or "revoke"' }, { status: 400 });
  }

  const db = await getDb();

  if (body.action === "grant") {
    await db.grantPermission(body.userId, body.permission, user.id);
  } else {
    await db.revokePermission(body.userId, body.permission);
  }

  return Response.json({ ok: true });
}
