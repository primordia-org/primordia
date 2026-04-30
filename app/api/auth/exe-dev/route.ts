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
import { getPublicOrigin } from "@/lib/public-origin";

/**
 * exe.dev SSO login
 * @description Reads injected `X-ExeDev-Email` header from the exe.dev proxy to find or create a user and issue a session. Redirects to `/__exe.dev/login` if the header is absent.
 * @tag Auth
 */
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
    const basePath = process.env.NEXT_BASE_PATH ?? "";
    const callbackPath =
      basePath + "/api/auth/exe-dev?next=" + encodeURIComponent(next);
    const loginUrl = "/__exe.dev/login?redirect=" + encodeURIComponent(callbackPath);
    return NextResponse.redirect(new URL(loginUrl, origin));
  }

  // Find or create the Primordia user whose username is the exe.dev email.
  const db = await getDb();
  let user = await db.getUserByUsername(email);
  if (!user) {
    const isFirstUser = (await db.getAllUsers()).length === 0;
    user = {
      id: generateId(),
      username: email,
      createdAt: Date.now(),
    };
    await db.createUser(user);
    if (isFirstUser) {
      await db.grantRole(user.id, "admin", "system");
    }
  }

  const sessionId = await createSession(user.id);

  // After login, send first-time users (no passkeys yet) to the passkey
  // registration prompt so their exe.dev account becomes accessible via passkey
  // in future sessions regardless of which login method they choose.
  const passkeys = await db.getPasskeysByUserId(user.id);
  const basePath = process.env.NEXT_BASE_PATH ?? "";
  const redirectPath =
    passkeys.length === 0
      ? basePath + "/register-passkey?next=" + encodeURIComponent(next)
      : basePath + next;

  const response = NextResponse.redirect(new URL(redirectPath, origin));
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_MS / 1000,
    path: "/",
  });
  return response;
}
