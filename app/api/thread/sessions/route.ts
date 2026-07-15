// app/api/thread/sessions/route.ts
// Lists active (non-terminal) sessions for the bell menu.
// Requires auth; returns only id, status, and truncated request text.

import { getSessionUser } from "@/lib/auth";
import { listSessionsFromFilesystem } from "@/lib/session-events";

const TERMINAL = new Set(["accepted", "rejected"]);

export interface BellSession {
  id: string;
  status: string;
  request: string;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const all = listSessionsFromFilesystem(process.cwd());
    const sessions: BellSession[] = all
      .filter((s) => !TERMINAL.has(s.status))
      .map((s) => ({
        id: s.id,
        status: s.status,
        request: s.request.slice(0, 60),
      }));
    return Response.json({ sessions });
  } catch {
    return Response.json({ sessions: [] });
  }
}
