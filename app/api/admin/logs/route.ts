// app/api/admin/logs/route.ts
// Streams production server logs as SSE.
// Admin only. GET /api/admin/logs
//
// SSE events: { text: string } | { done: true; exitCode: number }
//
// Proxies /_proxy/prod/logs from the reverse proxy, which captures the
// production Next.js server's stdout/stderr in a ring buffer.

import { type NextRequest } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(await isAdmin(user.id))) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const n = url.searchParams.get("n") ?? "100";
  const proxyPort = process.env.REVERSE_PROXY_PORT!;

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
