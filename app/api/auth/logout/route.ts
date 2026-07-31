// app/api/auth/logout/route.ts — Deletes the current session and clears the cookie.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/index";
import { SESSION_COOKIE } from "@/lib/auth";

/**
 * Log out
 * @description Deletes the current session and clears the session cookie.
 * @tag Auth
 */
export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    if (sessionId) {
      const db = await getDb();
      const session = await db.getSession(sessionId);
      const body = (await request.json().catch(() => null)) as { coreWebApiKeyShortId?: string | null } | null;
      const shortId = typeof body?.coreWebApiKeyShortId === "string" ? body.coreWebApiKeyShortId : null;
      if (session && shortId) {
        const key = await db.getRevokableAesKey(shortId);
        if (key && key.userId === session.userId && key.client === "web" && key.revokedAt === null) {
          await db.revokeRevokableAesKey(session.userId, shortId, Date.now());
        }
      }
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
