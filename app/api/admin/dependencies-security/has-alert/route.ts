// app/api/admin/dependencies-security/has-alert/route.ts
// Lightweight notification check for severe dependency audit findings.

import { getSessionUser, isAdmin } from "@/lib/auth";
import { readDependencyAuditNotification } from "@/lib/dependency-audit";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: "Forbidden" }, { status: 403 });

  const state = readDependencyAuditNotification(process.cwd());
  return Response.json({
    hasAlert: state.severeCount > 0,
    severeCount: state.severeCount,
    lastCheckedAt: state.lastCheckedAt,
  });
}
