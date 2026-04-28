// app/api/auth/passkey/login/finish/route.ts
// Verifies the WebAuthn authentication response, updates the counter, and issues a session.

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/index";
import {
  createSession,
  SESSION_COOKIE,
  CHALLENGE_COOKIE,
  SESSION_DURATION_MS,
} from "@/lib/auth";

/**
 * Finish passkey login
 * @description Verifies the WebAuthn `AuthenticationResponseJSON`, updates the credential counter, and sets a session cookie.
 * @tag Auth
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AuthenticationResponseJSON;

    const cookieStore = await cookies();
    const challengeId = cookieStore.get(CHALLENGE_COOKIE)?.value;
    if (!challengeId) {
      return NextResponse.json({ error: "Missing challenge cookie." }, { status: 400 });
    }

    const db = await getDb();
    const challengeRecord = await db.getChallenge(challengeId);
    if (!challengeRecord || challengeRecord.expiresAt < Date.now()) {
      if (challengeRecord) await db.deleteChallenge(challengeId);
      return NextResponse.json(
        { error: "Challenge expired. Please try again." },
        { status: 400 }
      );
    }

    const passkey = await db.getPasskeyByCredentialId(body.id);
    if (!passkey) {
      return NextResponse.json({ error: "Passkey not recognised." }, { status: 404 });
    }

    const origin = request.headers.get("origin") ?? "http://localhost:3000";
    const rpID = new URL(origin).hostname;

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: passkey.publicKey as Uint8Array<ArrayBuffer>,
        counter: passkey.counter,
        transports: passkey.transports
          ? (passkey.transports.split(",") as AuthenticatorTransportFuture[])
          : undefined,
      },
    });

    if (!verification.verified) {
      return NextResponse.json({ error: "Authentication failed." }, { status: 401 });
    }

    await db.updatePasskeyCounter(
      passkey.credentialId,
      verification.authenticationInfo.newCounter
    );
    await db.deleteChallenge(challengeId);

    const user = await db.getUserById(passkey.userId);
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const sessionId = await createSession(user.id);

    const response = NextResponse.json({ ok: true, username: user.username });
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
    console.error("[passkey/login/finish]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
