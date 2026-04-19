// app/api/auth/cross-device/approve/route.ts
// Called by the "approver" device (e.g. phone, already signed in) to approve
// a pending cross-device token.  Requires an active session.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/index";
import { getSessionUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as { tokenId?: string };
    const tokenId = body.tokenId?.trim();
    if (!tokenId) {
      return NextResponse.json({ error: "Missing tokenId" }, { status: 400 });
    }

    const db = await getDb();
    const token = await db.getCrossDeviceToken(tokenId);

    if (!token) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }
    if (token.expiresAt < Date.now()) {
      await db.deleteCrossDeviceToken(tokenId);
      return NextResponse.json({ error: "Token has expired" }, { status: 410 });
    }
    if (token.status !== "pending") {
      return NextResponse.json({ error: "Token already used" }, { status: 409 });
    }

    await db.approveCrossDeviceToken(tokenId, user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[cross-device/approve]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
