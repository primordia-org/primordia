// app/api/auth/cross-device/poll/route.ts
// Polled by the "requester" device (e.g. laptop) every 2 seconds.
// Returns the token status.  When "approved", creates a session and sets the
// session cookie so the requester is immediately signed in.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/index";
import { createSession, SESSION_COOKIE, SESSION_DURATION_MS } from "@/lib/auth";

/**
 * Poll cross-device sign-in status
 * @description Polled by the requesting device every 2 seconds. Returns `{ status }`. When status is `approved`, the session cookie is set and the device is signed in.
 * @tag Auth
 */
export async function GET(request: NextRequest) {
  try {
    const tokenId = request.nextUrl.searchParams.get("tokenId");
    if (!tokenId) {
      return NextResponse.json({ error: "Missing tokenId" }, { status: 400 });
    }

    const db = await getDb();
    const token = await db.getCrossDeviceToken(tokenId);

    if (!token) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }

    if (token.expiresAt < Date.now()) {
      await db.deleteCrossDeviceToken(tokenId);
      return NextResponse.json({ status: "expired" });
    }

    if (token.status === "pending") {
      return NextResponse.json({ status: "pending" });
    }

    // Token is approved — issue a session for the requester device.
    // Delete the token first to prevent double-issuance on concurrent polls.
    await db.deleteCrossDeviceToken(tokenId);

    const user = await db.getUserById(token.userId!);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const sessionId = await createSession(user.id);

    const response = NextResponse.json({ status: "approved", username: user.username });
    response.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_DURATION_MS / 1000,
      path: "/",
    });
    return response;
  } catch (err) {
    console.error("[cross-device/poll]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
