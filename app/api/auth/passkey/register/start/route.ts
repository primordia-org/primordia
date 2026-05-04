// app/api/auth/passkey/register/start/route.ts
// Generates WebAuthn registration options.

//
// Two modes:
//   1. Logged-in user — adds a passkey to an existing account.
//      No username body param required; the session user's info is used.
//      The challenge is saved with userId set so finish/ can skip user creation.
//   2. New user — creates a brand-new account (original behaviour).
//      Requires a valid username in the request body.

import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getDb } from "@/lib/db/index";
import { generateId, CHALLENGE_COOKIE, getSessionUser } from "@/lib/auth";

/**
 * Start passkey registration
 * @description Generates WebAuthn registration options. Call this before `navigator.credentials.create()`. Pass `{ username }` in the body for a new account, or omit when already signed in to add a passkey to an existing account.
 * @tag Auth
 */
export async function POST(request: NextRequest) {
  try {
    const db = await getDb();
    const origin = request.headers.get("origin") ?? "http://localhost:3000";
    const rpID = new URL(origin).hostname;

    // Mode 1: logged-in user adding a passkey to their existing account.
    const sessionUser = await getSessionUser();
    if (sessionUser) {
      // Exclude credentials the user already has so browsers don't offer duplicates.
      const existingPasskeys = await db.getPasskeysByUserId(sessionUser.id);
      const excludeCredentials = existingPasskeys.map((pk) => ({
        id: pk.credentialId,
        transports: (pk.transports?.split(",") ?? []) as AuthenticatorTransport[],
      }));

      const options = await generateRegistrationOptions({
        rpName: "Primordia",
        rpID,
        userName: sessionUser.username,
        userDisplayName: sessionUser.username,
        attestationType: "none",
        excludeCredentials,
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });

      const challengeId = generateId();
      await db.saveChallenge({
        id: challengeId,
        challenge: options.challenge,
        userId: sessionUser.id,
        username: sessionUser.username,
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
    }

    // Mode 2: new user registration.
    const body = (await request.json()) as { username?: string };
    const rawUsername = (body.username ?? "").trim().toLowerCase();

    if (!rawUsername || rawUsername.length < 2) {
      return NextResponse.json(
        { error: "Username must be at least 2 characters." },
        { status: 400 }
      );
    }
    if (!/^[a-z0-9_-]+$/.test(rawUsername)) {
      return NextResponse.json(
        { error: "Username may only contain letters, numbers, hyphens, and underscores." },
        { status: 400 }
      );
    }

    const existing = await db.getUserByUsername(rawUsername);
    if (existing) {
      return NextResponse.json({ error: "Username already taken." }, { status: 409 });
    }

    const options = await generateRegistrationOptions({
      rpName: "Primordia",
      rpID,
      userName: rawUsername,
      userDisplayName: rawUsername,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    const challengeId = generateId();
    await db.saveChallenge({
      id: challengeId,
      challenge: options.challenge,
      userId: null,
      username: rawUsername,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
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
    console.error("[passkey/register/start]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
