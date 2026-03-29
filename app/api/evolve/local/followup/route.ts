// app/api/evolve/local/followup/route.ts
// Accepts a follow-up request for an existing local evolve session.
// Only available when NODE_ENV=development.
//
// POST — submit a follow-up request for a session that is in "ready" state.
//   Body: { sessionId: string; request: string }
//   Returns: { ok: true }

import { getSessionUser } from '../../../../../lib/auth';
import { getDb } from '../../../../../lib/db';
import {
  runFollowupInWorktree,
  type LocalSession,
} from '../../../../../lib/local-evolve-sessions';

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

  const body = (await request.json()) as { sessionId?: string; request?: string };
  if (!body.sessionId || typeof body.sessionId !== 'string') {
    return Response.json({ error: 'sessionId string required' }, { status: 400 });
  }
  if (!body.request || typeof body.request !== 'string') {
    return Response.json({ error: 'request string required' }, { status: 400 });
  }

  const db = await getDb();
  const record = await db.getEvolveSession(body.sessionId);
  if (!record) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  if (record.status !== 'ready') {
    return Response.json(
      { error: `Session is not ready (current status: ${record.status})` },
      { status: 400 },
    );
  }

  // Build the LocalSession object from the DB record.
  const session: LocalSession = {
    id: record.id,
    branch: record.branch,
    worktreePath: record.worktreePath,
    status: record.status as LocalSession['status'],
    progressText: record.progressText,
    port: record.port,
    previewUrl: record.previewUrl,
    request: record.request,
    createdAt: record.createdAt,
  };

  // Update DB status immediately so the UI transitions without waiting.
  await db.updateEvolveSession(session.id, { status: 'running-claude' });

  // Fire-and-forget — runFollowupInWorktree handles all state transitions and
  // error cases internally, persisting each change to SQLite.
  void runFollowupInWorktree(session, body.request, process.cwd());

  return Response.json({ ok: true });
}
