// app/api/auth/cross-device/push/route.ts
// Creates a pre-approved cross-device token for the "push" sign-in flow.
//
// Unlike the pull flow (where the new device creates a pending token and waits
// for the logged-in device to approve), the push flow is initiated by the
// already-authenticated device from the hamburger menu. The token is created in
// "approved" state with the caller's userId and optionally carries AES-GCM key
// JWKs so the receiving device can restore credential encryption keys.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/index";
import { generateId, getSessionUser } from "@/lib/auth";

// Same TTL as pull tokens — 10 minutes to scan the QR code.
const CROSS_DEVICE_TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Start a "push" cross-device sign-in from the already-authenticated device.
 * @description Creates a pre-approved token carrying optional AES key JWKs.
 *   The scanning device uses GET /api/auth/cross-device/poll to receive the
 *   session cookie and restore encryption keys. Requires an active session.
 * @tag Auth
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as {
      apiKeyJwk?: string | null;
      credentialsKeyJwk?: string | null;
    };

    const db = await getDb();
    const tokenId = generateId();

    await db.createCrossDevicePushToken({
      id: tokenId,
      // Pre-approved: the scanning device gets a session immediately on first poll.
      status: "approved",
      userId: user.id,
      expiresAt: Date.now() + CROSS_DEVICE_TOKEN_TTL_MS,
      apiKeyJwk: body.apiKeyJwk ?? null,
      credentialsKeyJwk: body.credentialsKeyJwk ?? null,
    });

    // Clean up old tokens opportunistically.
    await db.deleteExpiredCrossDeviceTokens();

    return NextResponse.json({ tokenId });
  } catch (err) {
    console.error("[cross-device/push]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
