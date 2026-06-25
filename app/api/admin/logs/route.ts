// app/api/admin/logs/route.ts
// Streams production server logs as SSE. Admin only.

import { type NextRequest } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { followWorktreeLog, getProxyRoutingState, readWorktreeLogLines } from "@/lib/process-manager";

/**
 * Stream production server logs
 * @description SSE stream of the production Next.js server log file. Pass `n` (default 100) to set how many historical lines to replay. Admin only.
 * @tag Admin
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(await isAdmin(user.id))) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const n = Number.parseInt(url.searchParams.get("n") ?? "100", 10);
  const productionBranch = getProxyRoutingState(process.cwd()).productionBranch;
  if (!productionBranch) return new Response("No production branch configured", { status: 503 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      if (n !== 0) {
        const lines = readWorktreeLogLines(productionBranch, process.cwd());
        const selected = Number.isFinite(n) && n > 0 ? lines.slice(-n) : lines;
        if (selected.length > 0) send({ text: `${selected.join("\n")}\n` });
      }
      try {
        for await (const text of followWorktreeLog(productionBranch, process.cwd(), 500, req.signal)) {
          send({ text });
        }
      } catch (err) {
        if (!req.signal.aborted) send({ text: `\n[logs error] ${err instanceof Error ? err.message : String(err)}\n` });
      } finally {
        send({ done: true, exitCode: 0 });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
