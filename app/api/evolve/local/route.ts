// app/api/evolve/local/route.ts
// Local development evolve flow — bypasses GitHub entirely.
// Only available when NODE_ENV=development.
//
// POST — start a new local evolve session.
//   Body: { request: string }
//   Returns: { sessionId: string }
//
// GET — poll session status.
//   Query: ?sessionId=<id>
//   Returns: { status, logs, port, previewUrl, branch }

import * as path from 'path';
import {
  sessions,
  startLocalEvolve,
  appendLog,
  type LocalSession,
} from '../../../../lib/local-evolve-sessions';

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json(
      { error: 'Local evolve is only available in development mode' },
      { status: 403 },
    );
  }

  const body = (await request.json()) as { request?: string };
  if (!body.request || typeof body.request !== 'string') {
    return Response.json({ error: 'request string required' }, { status: 400 });
  }

  const sessionId = Date.now().toString();
  const branch = `preview-${sessionId}`;
  const repoRoot = process.cwd();
  const worktreePath = path.join(repoRoot, '..', `primordia-preview-${sessionId}`);

  const session: LocalSession = {
    id: sessionId,
    branch,
    worktreePath,
    status: 'starting',
    logs: '',
    port: null,
    previewUrl: null,
    devServerProcess: null,
  };

  sessions.set(sessionId, session);

  // Fire-and-forget — run async so POST returns immediately with the session ID.
  startLocalEvolve(session, body.request, repoRoot).catch((err) => {
    session.status = 'error';
    appendLog(
      session,
      `\n\n[error] ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });

  return Response.json({ sessionId });
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json(
      { error: 'Local evolve is only available in development mode' },
      { status: 403 },
    );
  }

  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId) {
    return Response.json({ error: 'sessionId query param required' }, { status: 400 });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  return Response.json({
    status: session.status,
    logs: session.logs,
    port: session.port,
    previewUrl: session.previewUrl,
    branch: session.branch,
  });
}
