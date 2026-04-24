// app/api/auth/logout/route.ts — Deletes the current session and clears the cookie.

/**
 * Log out
 * @description Deletes the current session and clears the session cookie.
 * @tags Auth
 * @openapi
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/index";
import { SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    if (sessionId) {
      const db = await getDb();
      await db.deleteSession(sessionId);
    }
  } catch {
    // Non-fatal — still clear the cookie
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response;
}
