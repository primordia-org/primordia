// app/api/auth/session/route.ts — Returns the currently logged-in user (or null).

/**
 * Get current session
 * @description Returns the currently authenticated user, or null if no session exists.
 * @tags Auth
 * @openapi
 */
import { NextResponse } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ user: null });
    const adminCheck = await isAdmin(user.id);
    return NextResponse.json({ user: { id: user.id, username: user.username, isAdmin: adminCheck } });
  } catch {
    return NextResponse.json({ user: null });
  }
}
