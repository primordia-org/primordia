// app/api/evolve/abort/route.ts
// Aborts the running Claude Code instance for a session, returning it to the
// ready state with whatever work was completed so far.
//
// POST
//   Body: { sessionId: string }
//   Returns: { ok: true } or { error: string }

import { getSessionUser } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';
import { abortClaudeRun } from '../../../../lib/evolve-sessions';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
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

  if (record.status !== 'running-claude' && record.status !== 'starting') {
    return Response.json(
      { error: `Session is not running (status: ${record.status})` },
      { status: 409 },
    );
  }

  const aborted = abortClaudeRun(body.sessionId);
  if (!aborted) {
    return Response.json(
      { error: 'No active Claude Code instance found for this session' },
      { status: 409 },
    );
  }

  return Response.json({ ok: true });
}
