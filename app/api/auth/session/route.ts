// app/api/auth/session/route.ts — Returns the currently logged-in user (or null).
import { NextResponse } from "next/server";
import { getSessionUser, isAdmin, hasEvolvePermission } from "@/lib/auth";

/**
 * Get current session
 * @description Returns the currently authenticated user, or null if no session exists.
 * @tag Auth
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ user: null });
    const [adminCheck, evolveCheck] = await Promise.all([isAdmin(user.id), hasEvolvePermission(user.id)]);
    return NextResponse.json({ user: { id: user.id, username: user.username, isAdmin: adminCheck, canEvolve: evolveCheck } });
  } catch {
    return NextResponse.json({ user: null });
  }
}
