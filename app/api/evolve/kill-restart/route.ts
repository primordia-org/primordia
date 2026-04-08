// app/api/evolve/kill-restart/route.ts
// Delegates to the reverse proxy to kill and restart a session's preview server.
//
// POST
//   Body: { sessionId: string }
//   Returns: { ok: true }
//
// The proxy manages all preview server processes. This route is a thin
// authenticated wrapper around POST /_proxy/preview/:id/restart.

import { getSessionUser } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';

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

  const proxyPort = process.env.REVERSE_PROXY_PORT;
  if (!proxyPort) {
    return Response.json({ error: 'REVERSE_PROXY_PORT not configured' }, { status: 503 });
  }

  try {
    const res = await fetch(
      `http://127.0.0.1:${proxyPort}/_proxy/preview/${body.sessionId}/restart`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return Response.json({ error: `Proxy error: ${text}` }, { status: res.status });
    }
  } catch (err) {
    return Response.json(
      { error: `Could not reach proxy: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 },
    );
  }

  return Response.json({ ok: true });
}
