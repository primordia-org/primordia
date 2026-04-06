// app/api/admin/logs/route.ts
// Streams the primordia systemd service journal as SSE.
// Admin only. GET /api/admin/logs
//
// SSE events: { text: string } | { done: true; exitCode: number }
//
// Runs: journalctl -u primordia -f -n 100
// -n 100  → emit last 100 lines before following
// -f      → keep following (long-lived stream)

import { spawn } from "child_process";
import { type NextRequest } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(await isAdmin(user.id))) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn("journalctl", ["-u", "primordia", "-f", "-n", "100"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: chunk.toString() })}\n\n`),
        );
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: chunk.toString() })}\n\n`),
        );
      });

      proc.on("close", (code) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, exitCode: code ?? 0 })}\n\n`),
        );
        controller.close();
      });

      proc.on("error", (err) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: `Error: ${err.message}\n` })}\n\n`),
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, exitCode: 1 })}\n\n`),
        );
        controller.close();
      });

      // Kill journalctl when the client disconnects
      req.signal.addEventListener("abort", () => proc.kill());
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
