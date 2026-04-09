// app/api/admin/logs/route.ts
// Streams production server logs as SSE.
// Admin only. GET /api/admin/logs
//
// SSE events: { text: string } | { done: true; exitCode: number }
//
// When REVERSE_PROXY_PORT is set (production): proxies /_proxy/prod/logs from
// the reverse proxy, which captures the production Next.js server's stdout/stderr.
// Otherwise (local dev / no proxy): falls back to journalctl -u primordia -f -n N.

import { spawn } from "child_process";
import { type NextRequest } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(await isAdmin(user.id))) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const n = url.searchParams.get("n") ?? "100";
  const proxyPort = process.env.REVERSE_PROXY_PORT;

  if (proxyPort) {
    // Proxy the log stream from the reverse proxy which captures prod server output.
    const proxyUrl = `http://localhost:${proxyPort}/_proxy/prod/logs${n === "0" ? "?n=0" : ""}`;
    const proxyRes = await fetch(proxyUrl, { signal: req.signal });
    return new Response(proxyRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Fallback: stream journalctl for local dev environments without a proxy.
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn("journalctl", ["-u", "primordia", "-f", "-n", n], {
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
