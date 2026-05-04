// app/api/evolve/abort/route.ts
// Aborts the running Claude Code instance for a session, returning it to the
// ready state with whatever work was completed so far.
//
// POST
//   Body: { sessionId: string }
//   Returns: { ok: true } or { error: string }

/** JSON body for POST /evolve/abort */
export interface EvolveAbortBody {
  sessionId: string; // The session ID (git branch name) of the running session to abort.
}

import { getSessionUser } from '../../../../lib/auth';
import { abortAgentRun } from '../../../../lib/evolve-sessions';
import {
  appendSessionEvent,
  getSessionNdjsonPath,
  getSessionFromFilesystem,
} from '../../../../lib/session-events';

/**
 * Abort the running Claude Code agent
 * @description Signals the active Claude Code process to stop and transitions the session back to 'ready' with whatever work was completed.
 * @tag Evolve
 * @body EvolveAbortBody
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

  const repoRoot = process.cwd();
  const record = getSessionFromFilesystem(body.sessionId, repoRoot);
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

  const aborted = abortAgentRun(body.sessionId);
  if (!aborted) {
    // No in-memory abort controller found — the server likely restarted while the
    // Claude Code process was running, wiping in-memory state but leaving the session
    // stuck in 'running-claude' or 'starting' in the filesystem.
    // Recover by transitioning the session to 'ready' directly so the user can
    // accept, reject, or submit a follow-up on whatever work was completed.
    const ndjsonPath = getSessionNdjsonPath(record.worktreePath);
    appendSessionEvent(ndjsonPath, {
      type: 'result',
      subtype: 'aborted',
      message:
        '🛑 Session recovered. The server restarted while Claude Code was running. ' +
        'Moving to ready state with work completed so far.' +
        (record.status === 'fixing-types' ? ' (Auto-accept was cancelled — you can accept or reject manually.)' : ''),
      ts: Date.now(),
    });
    return Response.json({ ok: true });
  }

  return Response.json({ ok: true });
}
