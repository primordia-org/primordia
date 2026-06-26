// app/api/evolve/kill-restart/route.ts
// Restarts a session's preview server through the shared process manager.
//
// POST
//   Body: { sessionId: string }
//   Returns: { ok: true }

import { getSessionUser } from '@/lib/auth';
import { getSessionFromFilesystem } from '@/lib/session-events';
import { restartWorktreeServer } from '@/lib/process-manager';

/** JSON body for POST /evolve/kill-restart */
export interface EvolveKillRestartBody {
  sessionId: string; // The session ID (git branch name) whose preview dev server should be restarted.
}

/**
 * Restart a session's preview dev server
 * @description Uses the process manager to kill and restart the session's preview dev server process.
 * @tag Evolve
 * @body EvolveKillRestartBody
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = (await request.json()) as { sessionId?: string };
  if (!body.sessionId || typeof body.sessionId !== 'string') {
    return Response.json({ error: 'sessionId string required' }, { status: 400 });
  }

  const record = getSessionFromFilesystem(body.sessionId, process.cwd());
  if (!record) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  try {
    await restartWorktreeServer(body.sessionId, 'dev', process.cwd());
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
