// app/api/auth/session/route.ts — Returns the currently logged-in user (or null).

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ user: null });
    return NextResponse.json({ user: { id: user.id, username: user.username } });
  } catch {
    return NextResponse.json({ user: null });
  }
}
