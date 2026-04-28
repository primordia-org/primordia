// app/api/auth/cross-device/start/route.ts
// Creates a new cross-device auth token.
// Called by the "requester" device (e.g. laptop) that wants to sign in.
// Returns a tokenId which the requester uses to display a QR code and poll.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/index";
import { generateId } from "@/lib/auth";

// Tokens expire after 10 minutes — long enough to find your phone and scan.
const CROSS_DEVICE_TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Start cross-device sign-in
 * @description Creates a new cross-device auth token. Returns `{ tokenId }` which the requesting device uses to display a QR code and poll for approval.
 * @tag Auth
 */
export async function POST() {
  try {
    const db = await getDb();
    const tokenId = generateId();

    await db.createCrossDeviceToken({
      id: tokenId,
      status: "pending",
      userId: null,
      expiresAt: Date.now() + CROSS_DEVICE_TOKEN_TTL_MS,
    });

    // Clean up old tokens opportunistically.
    await db.deleteExpiredCrossDeviceTokens();

    return NextResponse.json({ tokenId });
  } catch (err) {
    console.error("[cross-device/start]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
