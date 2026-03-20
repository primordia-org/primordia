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
//   Returns: { status, progressText, port, previewUrl, branch }

import {
  sessions,
  createLocalEvolveSession,
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

  const sessionId = await createLocalEvolveSession(body.request, process.cwd());
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
    progressText: session.progressText,
    port: session.port,
    previewUrl: session.previewUrl,
    branch: session.branch,
  });
}
