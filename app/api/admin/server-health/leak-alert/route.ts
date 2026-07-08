// app/api/admin/server-health/leak-alert/route.ts
// Lightweight notification-bell check for captured CPU/memory diagnostics.

import { getSessionUser, isAdmin } from '@/lib/auth';
import { readLeakDiagnosticsSummary } from '@/lib/leak-diagnostics';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: 'Admin required' }, { status: 403 });

  const diagnostics = readLeakDiagnosticsSummary(process.cwd());
  return Response.json({
    hasAlert: diagnostics.exists,
    diagnostics,
  });
}
