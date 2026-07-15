// app/api/evolve/kill-restart/route.ts
// Restarts a session's preview server through the shared process manager.
//
// POST
//   Body: { threadId: string }
//   Returns: { ok: true }

import { getSessionUser } from '@/lib/auth';
import { getSessionFromFilesystem } from '@/lib/session-events';
import { restartWorktreeServer } from '@/lib/process-manager';

/** JSON body for POST /evolve/kill-restart */
export interface EvolveKillRestartBody {
  threadId: string; // The thread ID (git branch name) whose preview dev server should be restarted.
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

  const body = (await request.json()) as { threadId?: string };
  if (!body.threadId || typeof body.threadId !== 'string') {
    return Response.json({ error: 'threadId string required' }, { status: 400 });
  }

  const record = getSessionFromFilesystem(body.threadId, process.cwd());
  if (!record) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  try {
    await restartWorktreeServer(body.threadId, 'dev', process.cwd());
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
