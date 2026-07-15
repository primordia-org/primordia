// app/api/auth/session/route.ts — Returns the currently logged-in user (or null).
import { NextResponse } from "next/server";
import { getSessionUser, isAdmin, hasThreadPermission } from "@/lib/auth";

/**
 * Get current session
 * @description Returns the currently authenticated user, or null if no session exists.
 * @tag Auth
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ user: null });
    const [adminCheck, threadCheck] = await Promise.all([isAdmin(user.id), hasThreadPermission(user.id)]);
    return NextResponse.json({ user: { id: user.id, username: user.username, isAdmin: adminCheck, canStartThreads: threadCheck } });
  } catch {
    return NextResponse.json({ user: null });
  }
}
