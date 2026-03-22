// app/api/auth/passkey/register/start/route.ts
// Generates WebAuthn registration options for a new user.

import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getDb } from "@/lib/db/index";
import { generateId, CHALLENGE_COOKIE } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
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

    const db = await getDb();
    const existing = await db.getUserByUsername(rawUsername);
    if (existing) {
      return NextResponse.json({ error: "Username already taken." }, { status: 409 });
    }

    const origin = request.headers.get("origin") ?? "http://localhost:3000";
    const rpID = new URL(origin).hostname;

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
