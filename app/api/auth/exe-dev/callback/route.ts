// app/api/auth/exe-dev/callback/route.ts
//
// Called after a user authenticates via exe.dev. The exe.dev HTTP proxy injects
// two headers on every request from an authenticated user:
//   X-ExeDev-UserID  — stable unique identifier for the user
//   X-ExeDev-Email   — the user's email address
//
// This route reads those headers, finds or creates a Primordia user record,
// creates a session cookie, and redirects to the intended destination.
//
// The login flow is:
//   1. Browser visits /__exe.dev/login?redirect=/api/auth/exe-dev/callback?next={dest}
//   2. exe.dev authenticates the user and redirects back here with the headers set
//   3. We create/find the user and session, then redirect to {dest}

import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/index";
import {
  generateId,
  createSession,
  SESSION_COOKIE,
  SESSION_DURATION_MS,
} from "@/lib/auth";

export async function GET(request: NextRequest) {
  const exeUserId = request.headers.get("X-ExeDev-UserID");

  if (!exeUserId) {
    // Headers not injected — user didn't go through exe.dev auth or the proxy
    // isn't present (e.g. local dev without exe.dev). Redirect to login with error.
    return NextResponse.redirect(new URL("/login?error=exe-auth-failed", request.url));
  }

  const db = await getDb();

  // Derive a stable, unique username from the exe.dev user ID.
  // Prefixed with "exe-" to avoid collisions with passkey usernames.
  const username = `exe-${exeUserId}`;

  let user = await db.getUserByUsername(username);
  if (!user) {
    user = {
      id: generateId(),
      username,
      createdAt: Date.now(),
    };
    await db.createUser(user);
  }

  const sessionId = await createSession(user.id);

  const nextPath = request.nextUrl.searchParams.get("next") ?? "/";
  const response = NextResponse.redirect(new URL(nextPath, request.url));
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
    path: "/",
  });

  return response;
}
