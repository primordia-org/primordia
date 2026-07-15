// app/api/thread/stream/route.ts
// Streams live session progress as SSE.
//
// GET ?threadId=<id>&offset=<n>
//   threadId — the thread to watch

//   offset    — number of NDJSON lines the client already has (default 0)
//
// SSE events:
//   data: { events: SessionEvent[], lineCount: number, status: string, previewUrl: string | null }
// Final event (terminal state):
//   data: { events: SessionEvent[], lineCount: number, status: string, previewUrl: string | null, done: true }

import { getSessionUser } from '@/lib/auth';
import { readSessionEvents, getSessionNdjsonPath, getSessionFromFilesystem } from '@/lib/session-events';
import type { SessionEvent } from '@/lib/session-events';
import * as fs from 'fs';
import * as path from 'path';

const POLL_INTERVAL_MS = 500;

function isTerminal(status: string): boolean {
  // 'ready' is NOT terminal here: the session can still receive new events
  // (e.g. conflict-resolution runs triggered by upstream-sync, or follow-up
  // requests).  Only 'accepted' and 'rejected' are truly final.
  return status === 'accepted' || status === 'rejected';
}

/**
 * Stream thread progress
 * @description SSE stream of live session progress. Pass `threadId` and optional `offset` (number of events already received). Emits JSON events with `events`, `status`, `devServerStatus`, and `previewUrl`. Final event includes `done: true`.
 * @tag Thread
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('threadId');
  if (!sessionId) {
    return Response.json({ error: 'threadId query param required' }, { status: 400 });
  }
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

  const abortSignal = request.signal;
  const encoder = new TextEncoder();
  const repoRoot = process.cwd();

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

          const session = getSessionFromFilesystem(sessionId, repoRoot);

          if (!session) {
            sendEvent({ error: 'Thread not found', done: true });
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
          }

          // Check for OAuth token refresh: if the worker updated .credentials.json
          // while running, cleanup() writes the new content here for the browser to
          // re-encrypt and save. Read-and-delete atomically so it's delivered once.
          let updatedCredentials: string | null = null;
          const updatedCredPath = path.join(session.worktreePath, '.credentials.updated');
          try {
            if (fs.existsSync(updatedCredPath)) {
              updatedCredentials = fs.readFileSync(updatedCredPath, 'utf8');
              fs.unlinkSync(updatedCredPath);
            }
          } catch { /* best-effort */ }

          const hasChange =
            events.length > 0 ||
            session.status !== lastSentStatus ||
            session.previewUrl !== lastSentPreviewUrl ||
            updatedCredentials !== null;

          if (hasChange || terminal) {
            sendEvent({
              events,
              lineCount: totalLines,
              status: session.status,
              previewUrl: session.previewUrl,
              ...(updatedCredentials ? { updatedCredentials } : {}),
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
