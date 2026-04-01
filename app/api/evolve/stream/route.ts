// app/api/evolve/stream/route.ts
// Streams live session progress as SSE so the session page sees updates immediately
// instead of waiting for a polling interval.
//
// GET ?sessionId=<id>&offset=<n>
//   sessionId — the evolve session to watch
//   offset    — number of progressText characters the client already has (default 0)
//
// SSE events:
//   data: { progressDelta: string, status: string, devServerStatus: string, previewUrl: string | null }
// Final event (terminal state):
//   data: { progressDelta: string, status: string, devServerStatus: string, previewUrl: string | null, done: true }

import { getSessionUser } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';
import { inferDevServerStatus } from '../../../../lib/local-evolve-sessions';

const POLL_INTERVAL_MS = 500;

function isTerminal(status: string, devServerStatus: string): boolean {
  return (
    status === 'accepted' ||
    status === 'rejected' ||
    status === 'error' ||
    (status === 'ready' && (devServerStatus === 'running' || devServerStatus === 'disconnected'))
  );
}

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return Response.json({ error: 'sessionId query param required' }, { status: 400 });
  }
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

  const abortSignal = request.signal;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastSentOffset = offset;
      // Use sentinel values so the first iteration always sends the current state.
      let lastSentStatus = '';
      let lastSentDevServerStatus = '';
      let lastSentPreviewUrl: string | null | undefined = undefined;

      const sendEvent = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        while (true) {
          if (abortSignal.aborted) {
            controller.close();
            return;
          }

          const db = await getDb();
          const session = await db.getEvolveSession(sessionId);

          if (!session) {
            sendEvent({ error: 'Session not found', done: true });
            controller.close();
            return;
          }

          const devServerStatus = inferDevServerStatus(sessionId, session.port);
          const progressText = session.progressText ?? '';
          const progressDelta = progressText.slice(lastSentOffset);
          const terminal = isTerminal(session.status, devServerStatus);

          const hasChange =
            progressDelta.length > 0 ||
            session.status !== lastSentStatus ||
            devServerStatus !== lastSentDevServerStatus ||
            session.previewUrl !== lastSentPreviewUrl;

          if (hasChange || terminal) {
            sendEvent({
              progressDelta,
              status: session.status,
              devServerStatus,
              previewUrl: session.previewUrl,
              ...(terminal ? { done: true } : {}),
            });
            lastSentOffset = progressText.length;
            lastSentStatus = session.status;
            lastSentDevServerStatus = devServerStatus;
            lastSentPreviewUrl = session.previewUrl;
          }

          if (terminal) {
            controller.close();
            return;
          }

          // Wait before the next poll, but wake early if the client disconnects.
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, POLL_INTERVAL_MS);
            abortSignal.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          sendEvent({ error: msg, done: true });
          controller.close();
        } catch {
          // Stream already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
