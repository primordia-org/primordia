// app/api/claude-auth/logs/route.ts
// GET ?sessionId=... — SSE stream of stdout/stderr/system log lines from a
// claude auth session.  Replays buffered lines then streams live ones.
// Closes automatically once the process exits.

import { NextRequest } from 'next/server';
import { subscribeToLogs, type LogLine } from '@/lib/claude-temp-auth';

export const dynamic = 'force-dynamic';

/**
 * Stream Claude auth session logs
 * @description SSE stream of stdout/stderr/system log lines from a `claude auth login` helper session. Pass `sessionId` as a query parameter. Closes when the process exits.
 * @tag Auth
 * @responseContentType text/event-stream
 * @response { description: "SSE stream of log lines" }
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? '';

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      function send(line: LogLine) {
        try {
          const data = `data: ${JSON.stringify(line)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          // controller may be closed
        }
      }

      const { unsubscribe, found } = subscribeToLogs(sessionId, send);

      if (!found) {
        send({ source: 'system', text: `Session not found: ${sessionId}`, ts: Date.now() });
        controller.close();
        return;
      }

      // Close the SSE stream when the client disconnects.
      req.signal.addEventListener('abort', () => {
        unsubscribe();
        try { controller.close(); } catch { /* ignore */ }
      });
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
