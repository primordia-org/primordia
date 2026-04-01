// app/api/evolve/kill-restart/route.ts
// Kills any process listening on a session's port, then re-spawns bun run dev
// in that session's worktree on the same port.
//
// Only available in development (NODE_ENV=development).
//
// POST
//   Body: { sessionId: string }
//   Returns: { ok: true }
//
// The actual restart runs fire-and-forget; the caller should poll
// GET /api/evolve?sessionId=... for live status updates.

import { getSessionUser } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';
import {
  restartDevServerInWorktree,
  type LocalSession,
} from '../../../../lib/local-evolve-sessions';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (process.env.NODE_ENV !== 'development') {
    return Response.json(
      { error: 'Local evolve is only available in development mode' },
      { status: 403 },
    );
  }

  const body = (await request.json()) as { sessionId?: string };
  if (!body.sessionId || typeof body.sessionId !== 'string') {
    return Response.json({ error: 'sessionId string required' }, { status: 400 });
  }

  const db = await getDb();
  const record = await db.getEvolveSession(body.sessionId);
  if (!record) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  // Build the LocalSession object from the DB record.
  const session: LocalSession = {
    id: record.id,
    branch: record.branch,
    worktreePath: record.worktreePath,
    status: record.status as LocalSession['status'],
    devServerStatus: 'disconnected',
    progressText: record.progressText,
    port: record.port,
    previewUrl: record.previewUrl,
    request: record.request,
    createdAt: record.createdAt,
  };

  // Determine the public hostname for preview URLs (same logic as POST /api/evolve).
  const fwdHost = request.headers.get('x-forwarded-host');
  const publicHostname = fwdHost ? fwdHost.split(':')[0] : 'localhost';

  // Fire-and-forget — restartDevServerInWorktree handles all state transitions
  // and error cases internally, persisting each change to SQLite.
  void restartDevServerInWorktree(session, process.cwd(), publicHostname);

  return Response.json({ ok: true });
}
