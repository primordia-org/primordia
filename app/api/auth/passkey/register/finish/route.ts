// app/api/auth/passkey/register/finish/route.ts
// Verifies the WebAuthn registration response, creates the user + passkey, and issues a session.

import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/index";
import {
  generateId,
  createSession,
  SESSION_COOKIE,
  CHALLENGE_COOKIE,
  SESSION_DURATION_MS,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RegistrationResponseJSON;

    const cookieStore = await cookies();
    const challengeId = cookieStore.get(CHALLENGE_COOKIE)?.value;
    if (!challengeId) {
      return NextResponse.json({ error: "Missing challenge cookie." }, { status: 400 });
    }

    const db = await getDb();
    const challengeRecord = await db.getChallenge(challengeId);
    if (!challengeRecord || challengeRecord.expiresAt < Date.now()) {
      if (challengeRecord) await db.deleteChallenge(challengeId);
      return NextResponse.json({ error: "Challenge expired. Please try again." }, { status: 400 });
    }
    if (!challengeRecord.username) {
      return NextResponse.json({ error: "Challenge missing username." }, { status: 400 });
    }

    const origin = request.headers.get("origin") ?? "http://localhost:3000";
    const rpID = new URL(origin).hostname;

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Passkey verification failed." }, { status: 400 });
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    let userId: string;

    if (challengeRecord.userId) {
      // Logged-in user adding a passkey to their existing account.
      userId = challengeRecord.userId;
    } else {
      // New user — create the account.
      userId = generateId();
      const isFirstUser = (await db.getAllUsers()).length === 0;
      await db.createUser({
        id: userId,
        username: challengeRecord.username,
        createdAt: Date.now(),
      });
      if (isFirstUser) {
        await db.grantRole(userId, "admin", "system");
      }
    }

    await db.savePasskey({
      id: generateId(),
      userId,
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports?.join(",") ?? null,
      createdAt: Date.now(),
    });

    await db.deleteChallenge(challengeId);

    // Issue (or refresh) session
    const sessionId = await createSession(userId);

    const response = NextResponse.json({
      ok: true,
      username: challengeRecord.username,
    });
    response.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_DURATION_MS / 1000,
      path: "/",
    });
    response.cookies.set(CHALLENGE_COOKIE, "", { maxAge: 0, path: "/" });
    return response;
  } catch (err) {
    console.error("[passkey/register/finish]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
