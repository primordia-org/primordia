// app/api/auth/passkey/login/start/route.ts
// Generates WebAuthn authentication options.
// If a username is provided, restricts to that user's credentials.
// If no username, returns discoverable-credential options (passkey autofill).

import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { getDb } from "@/lib/db/index";
import { generateId, CHALLENGE_COOKIE } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { username?: string };
    const db = await getDb();
    const origin = request.headers.get("origin") ?? "http://localhost:3000";
    const rpID = new URL(origin).hostname;

    let allowCredentials:
      | Array<{ id: string; transports?: AuthenticatorTransportFuture[] }>
      | undefined;

    const rawUsername = body.username?.trim().toLowerCase();
    if (rawUsername) {
      const user = await db.getUserByUsername(rawUsername);
      if (user) {
        const passkeys = await db.getPasskeysByUserId(user.id);
        allowCredentials = passkeys.map((pk) => ({
          id: pk.credentialId,
          transports: pk.transports
            ? (pk.transports.split(",") as AuthenticatorTransportFuture[])
            : undefined,
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
      allowCredentials,
    });

    const challengeId = generateId();
    await db.saveChallenge({
      id: challengeId,
      challenge: options.challenge,
      userId: null,
      username: rawUsername ?? null,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    await db.deleteExpiredChallenges();

    const response = NextResponse.json({ options });
    response.cookies.set(CHALLENGE_COOKIE, challengeId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 300,
      path: "/",
    });
    return response;
  } catch (err) {
    console.error("[passkey/login/start]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
