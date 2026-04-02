// lib/auth.ts — Session and auth helpers for server-side use.

import { cookies } from "next/headers";
import { getDb } from "./db/index";
import type { User } from "./db/types";

export const SESSION_COOKIE = "primordia-session";
export const CHALLENGE_COOKIE = "passkey-challenge-id";
// 30-day session lifetime
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/** Generate a cryptographically random UUID. */
export function generateId(): string {
  return crypto.randomUUID();
}

/** Create a new session for the given user, persist it, and return the session ID. */
export async function createSession(userId: string): Promise<string> {
  const db = await getDb();
  const sessionId = generateId();
  await db.createSession({
    id: sessionId,
    userId,
    expiresAt: Date.now() + SESSION_DURATION_MS,
  });
  return sessionId;
}

/** Returns true if the given userId has the "admin" role. */
export async function isAdmin(userId: string): Promise<boolean> {
  const db = await getDb();
  const roles = await db.getUserRoles(userId);
  return roles.includes("admin");
}

/**
 * Returns true if the user may use the evolve flow.
 * Users with the "admin" role always have access; others need the "can_evolve" role.
 */
export async function hasEvolvePermission(userId: string): Promise<boolean> {
  const db = await getDb();
  const roles = await db.getUserRoles(userId);
  return roles.includes("admin") || roles.includes("can_evolve");
}

/**
 * Read the session cookie, look up the session in the DB, and return the
 * associated user — or null if there is no valid session.
 */
export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const db = await getDb();
  const session = await db.getSession(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    await db.deleteSession(sessionId);
    return null;
  }
  return db.getUserById(session.userId);
}
