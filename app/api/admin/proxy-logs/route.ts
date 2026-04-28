// app/api/admin/proxy-logs/route.ts
// Streams the primordia-proxy systemd service journal as SSE.
// Admin only. GET /api/admin/proxy-logs
//
// SSE events: { text: string } | { done: true; exitCode: number }
//
// Runs: journalctl -u primordia-proxy -f -n 100
// -n 100  → emit last 100 lines before following
// -f      → keep following (long-lived stream)
//
// On non-Linux platforms (e.g. macOS) where journalctl is unavailable, emits
// a single informational message and closes the stream.

import { spawn } from "child_process";
import { type NextRequest } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

/**
 * Stream proxy service logs
 * @description SSE stream of the `primordia-proxy` systemd journal (`journalctl -f -n 100`). Admin only. Returns an informational message on non-Linux platforms.
 * @tag Admin
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(await isAdmin(user.id))) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();

  // journalctl is only available on Linux (systemd). On macOS the proxy runs
  // as a plain bun process — start it in a terminal to see its output.
  if (process.platform !== "linux") {
    const msg =
      "journalctl is not available on this platform. " +
      "Proxy logs are only streamed via systemd on Linux. " +
      "Run the proxy directly in a terminal to see its output.\n";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: msg })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, exitCode: 0 })}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  const stream = new ReadableStream({
    start(controller) {
      const url = new URL(req.url);
      const n = url.searchParams.get("n") ?? "100";
      const proc = spawn("journalctl", ["-u", "primordia-proxy", "-f", "-n", n], {
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

  return new Response(stream, { headers: SSE_HEADERS });
}
