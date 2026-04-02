// app/api/oops/route.ts
// Runs a shell command on the server and streams stdout + stderr as SSE.
// Admin (owner) only — all other requests are rejected with 401/403.
//
// POST body:  { cmd: string }
// SSE events: { text: string } | { done: true; exitCode: number }

import { spawn } from "child_process";
import { type NextRequest } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(await isAdmin(user.id))) return new Response("Forbidden", { status: 403 });

  const body = (await req.json()) as { cmd?: string };
  const cmd = body.cmd?.trim() ?? "";
  if (!cmd) return new Response("Bad request: cmd is required", { status: 400 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn(cmd, [], { shell: true, cwd: process.cwd() });

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
          encoder.encode(`data: ${JSON.stringify({ text: `spawn error: ${err.message}\n` })}\n\n`),
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, exitCode: 1 })}\n\n`),
        );
        controller.close();
      });

      // Kill the child process if the client disconnects
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
