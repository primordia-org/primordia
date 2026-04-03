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

  if (
    record.status !== 'running-claude' &&
    record.status !== 'starting' &&
    record.status !== 'fixing-types'
  ) {
    return Response.json(
      { error: `Session is not running (status: ${record.status})` },
      { status: 409 },
    );
  }

  const aborted = abortClaudeRun(body.sessionId);
  if (!aborted) {
    // No in-memory abort controller found — the server likely restarted while the
    // Claude Code process was running, wiping in-memory state but leaving the session
    // stuck in 'running-claude' or 'starting' in SQLite.
    // Recover by transitioning the session to 'ready' directly so the user can
    // accept, reject, or submit a follow-up on whatever work was completed.
    await db.updateEvolveSession(body.sessionId, {
      status: 'ready',
      progressText:
        record.progressText +
        '\n\n🛑 **Session recovered.** The server restarted while Claude Code was running. ' +
        'Moving to ready state with work completed so far.\n' +
        (record.status === 'fixing-types' ? '_(Auto-accept was cancelled — you can accept or reject manually.)_\n' : ''),
      port: record.port,
      previewUrl: record.previewUrl,
    });
    return Response.json({ ok: true });
  }

  return Response.json({ ok: true });
}
