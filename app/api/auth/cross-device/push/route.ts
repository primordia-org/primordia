// app/api/auth/cross-device/push/route.ts
// Creates a pre-approved cross-device token for the "push" sign-in flow.
//
// Unlike the pull flow (where the new device creates a pending token and waits
// for the logged-in device to approve), the push flow is initiated by the
// already-authenticated device from the hamburger menu. The token is created in
// "approved" state with the caller's userId.
//
// Credential transfer uses ECIES (see lib/cross-device-creds.ts): the client
// passes an encrypted credential bundle; the server stores it on the token.
// The receiving device fetches A_pub + ciphertext via the poll route and decrypts
// using the ephemeral private key it received from the QR code URL fragment.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/index";
import { generateId, getSessionUser } from "@/lib/auth";
import type { PushCredBundle } from "@/lib/cross-device-creds";

// Same TTL as pull tokens — 10 minutes to scan the QR code.
const CROSS_DEVICE_TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Start a "push" cross-device sign-in from the already-authenticated device.
 * @description Creates a pre-approved token. The scanning device uses
 *   GET /api/auth/cross-device/poll to receive the session cookie and any
 *   encrypted credentials. Requires an active session.
 * @tag Auth
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as { encryptedCredentials?: PushCredBundle | null };
    const encryptedCredsJson = body.encryptedCredentials
      ? JSON.stringify(body.encryptedCredentials)
      : null;

    const db = await getDb();
    const tokenId = generateId();

    await db.createCrossDeviceToken({
      id: tokenId,
      // Pre-approved: the scanning device gets a session immediately on first poll.
      status: "approved",
      userId: user.id,
      expiresAt: Date.now() + CROSS_DEVICE_TOKEN_TTL_MS,
      encryptedCredentials: encryptedCredsJson,
    });

    // Clean up old tokens opportunistically.
    await db.deleteExpiredCrossDeviceTokens();

    return NextResponse.json({ tokenId });
  } catch (err) {
    console.error("[cross-device/push]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
