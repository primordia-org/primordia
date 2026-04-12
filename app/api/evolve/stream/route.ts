// app/api/evolve/stream/route.ts
// Streams live session progress as SSE.
//
// GET ?sessionId=<id>&offset=<n>
//   sessionId — the evolve session to watch
//   offset    — number of NDJSON lines the client already has (default 0)
//
// SSE events:
//   data: { events: SessionEvent[], lineCount: number, status: string, previewUrl: string | null }
// Final event (terminal state):
//   data: { events: SessionEvent[], lineCount: number, status: string, previewUrl: string | null, done: true }

import { getSessionUser } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';
import { readSessionEvents, getSessionNdjsonPath, getCandidateWorktreePath, deriveSessionFromLog } from '../../../../lib/session-events';
import type { SessionEvent } from '../../../../lib/session-events';
import * as fs from 'fs';

const POLL_INTERVAL_MS = 500;

function isTerminal(status: string): boolean {
  return status === 'accepted' || status === 'rejected' || status === 'ready';
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
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
      let lastSentLineCount = offset;
      let lastSentStatus = '';
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
          let session = await db.getEvolveSession(sessionId);

          if (!session) {
            // Not in the local DB — try reconstructing from the NDJSON log.
            session = deriveSessionFromLog(sessionId, getCandidateWorktreePath(sessionId));
          }

          if (!session) {
            sendEvent({ error: 'Session not found', done: true });
            controller.close();
            return;
          }

          const terminal = isTerminal(session.status);
          const ndjsonPath = getSessionNdjsonPath(session.worktreePath);
          const hasNdjson = fs.existsSync(ndjsonPath);

          let events: SessionEvent[] = [];
          let totalLines = lastSentLineCount;

          if (hasNdjson) {
            const result = readSessionEvents(ndjsonPath, lastSentLineCount);
            events = result.events;
            totalLines = result.totalLines;
          } else if (session.progressText) {
            // Legacy fallback: serve progressText as a single legacy_text event
            // Always resend the full content (lineCount stays at 0)
            events = [{ type: 'legacy_text', content: session.progressText }];
            totalLines = 0;
          }

          const hasChange =
            events.length > 0 ||
            session.status !== lastSentStatus ||
            session.previewUrl !== lastSentPreviewUrl;

          if (hasChange || terminal) {
            sendEvent({
              events,
              lineCount: totalLines,
              status: session.status,
              previewUrl: session.previewUrl,
              ...(terminal ? { done: true } : {}),
            });
            lastSentLineCount = totalLines;
            lastSentStatus = session.status;
            lastSentPreviewUrl = session.previewUrl;
          }

          if (terminal) {
            controller.close();
            return;
          }

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
