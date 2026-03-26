// app/api/auth/exe-dev/route.ts
// Handles "Login with exe.dev" authentication.
//
// exe.dev's HTTP proxy injects two headers for authenticated users:
//   X-ExeDev-UserID — stable opaque user identifier
//   X-ExeDev-Email  — the user's email address
//
// GET flow:
//   1. If X-ExeDev-Email is present → find or create a Primordia user whose
//      username is that email, issue a session cookie, and redirect to `next`.
//   2. If not present → redirect to /__exe.dev/login so the proxy can
//      authenticate the user, then send them back here.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/index";
import { generateId, createSession, SESSION_COOKIE, SESSION_DURATION_MS } from "@/lib/auth";

/**
 * Returns the public-facing origin (scheme + host) for this request.
 *
 * When the app runs behind exe.dev's reverse proxy, Next.js sees
 * "localhost" as the host in req.url / req.nextUrl, because the proxy
 * terminates TLS and forwards traffic internally. The proxy preserves the
 * original Host header and may also set X-Forwarded-Proto / X-Forwarded-Host,
 * so we prefer those over the internal URL when building redirect targets.
 */
function getPublicOrigin(req: NextRequest): string {
  const proto =
    req.headers.get("x-forwarded-proto") ??
    req.nextUrl.protocol.replace(/:$/, "");
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    req.nextUrl.host;
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const next = searchParams.get("next") ?? "/";

  const email = req.headers.get("x-exedev-email");

  // Use the public origin so that redirect Location headers contain the
  // correct external hostname rather than "localhost".
  const origin = getPublicOrigin(req);

  if (!email) {
    // Not authenticated with exe.dev yet — bounce through the exe.dev login page.
    // After login the proxy redirects back here with the headers injected.
    const callbackPath =
      "/api/auth/exe-dev?next=" + encodeURIComponent(next);
    const loginUrl = "/__exe.dev/login?redirect=" + encodeURIComponent(callbackPath);
    return NextResponse.redirect(new URL(loginUrl, origin));
  }

  // Find or create the Primordia user whose username is the exe.dev email.
  const db = await getDb();
  let user = await db.getUserByUsername(email);
  if (!user) {
    user = {
      id: generateId(),
      username: email,
      createdAt: Date.now(),
    };
    await db.createUser(user);
  }

  const sessionId = await createSession(user.id);

  const response = NextResponse.redirect(new URL(next, origin));
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_MS / 1000,
    path: "/",
  });
  return response;
}
