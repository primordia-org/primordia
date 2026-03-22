// lib/db/neon.ts — Neon PostgreSQL adapter for Vercel production deployments.
// Requires DATABASE_URL env var pointing to a Neon connection string.

import type { DbAdapter, User, Passkey, Challenge, Session } from "./types";
import { neon } from "@neondatabase/serverless";

export async function createNeonAdapter(): Promise<DbAdapter> {
  const sql = neon(process.env.DATABASE_URL!);

  // Create tables if they don't exist (idempotent — safe to run on every cold start)
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      created_at BIGINT NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      credential_id TEXT NOT NULL UNIQUE,
      public_key BYTEA NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      device_type TEXT NOT NULL,
      backed_up BOOLEAN NOT NULL DEFAULT FALSE,
      transports TEXT,
      created_at BIGINT NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      expires_at BIGINT NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at BIGINT NOT NULL
    )`;

  const adapter: DbAdapter = {
    async createUser(user: User) {
      await sql`INSERT INTO users (id, username, created_at) VALUES (${user.id}, ${user.username}, ${user.createdAt})`;
    },
    async getUserByUsername(username: string) {
      const rows =
        await sql`SELECT * FROM users WHERE username = ${username}`;
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id as string,
        username: r.username as string,
        createdAt: Number(r.created_at),
      };
    },
    async getUserById(id: string) {
      const rows = await sql`SELECT * FROM users WHERE id = ${id}`;
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id as string,
        username: r.username as string,
        createdAt: Number(r.created_at),
      };
    },
    async savePasskey(passkey: Passkey) {
      const pubKeyBuf = Buffer.from(passkey.publicKey);
      await sql`
        INSERT INTO passkeys
          (id, user_id, credential_id, public_key, counter, device_type, backed_up, transports, created_at)
        VALUES
          (${passkey.id}, ${passkey.userId}, ${passkey.credentialId}, ${pubKeyBuf},
           ${passkey.counter}, ${passkey.deviceType}, ${passkey.backedUp},
           ${passkey.transports ?? null}, ${passkey.createdAt})`;
    },
    async getPasskeysByUserId(userId: string) {
      const rows =
        await sql`SELECT * FROM passkeys WHERE user_id = ${userId}`;
      return rows.map((r) => ({
        id: r.id as string,
        userId: r.user_id as string,
        credentialId: r.credential_id as string,
        publicKey: new Uint8Array(r.public_key as Buffer),
        counter: Number(r.counter),
        deviceType: r.device_type as string,
        backedUp: r.backed_up as boolean,
        transports: r.transports as string | null,
        createdAt: Number(r.created_at),
      }));
    },
    async getPasskeyByCredentialId(credentialId: string) {
      const rows =
        await sql`SELECT * FROM passkeys WHERE credential_id = ${credentialId}`;
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id as string,
        userId: r.user_id as string,
        credentialId: r.credential_id as string,
        publicKey: new Uint8Array(r.public_key as Buffer),
        counter: Number(r.counter),
        deviceType: r.device_type as string,
        backedUp: r.backed_up as boolean,
        transports: r.transports as string | null,
        createdAt: Number(r.created_at),
      };
    },
    async updatePasskeyCounter(credentialId: string, counter: number) {
      await sql`UPDATE passkeys SET counter = ${counter} WHERE credential_id = ${credentialId}`;
    },
    async saveChallenge(challenge: Challenge) {
      await sql`
        INSERT INTO challenges (id, challenge, user_id, username, expires_at)
        VALUES (${challenge.id}, ${challenge.challenge}, ${challenge.userId ?? null},
                ${challenge.username ?? null}, ${challenge.expiresAt})`;
    },
    async getChallenge(id: string) {
      const rows =
        await sql`SELECT * FROM challenges WHERE id = ${id}`;
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id as string,
        challenge: r.challenge as string,
        userId: (r.user_id as string | null) ?? null,
        username: (r.username as string | null) ?? null,
        expiresAt: Number(r.expires_at),
      };
    },
    async deleteChallenge(id: string) {
      await sql`DELETE FROM challenges WHERE id = ${id}`;
    },
    async deleteExpiredChallenges() {
      await sql`DELETE FROM challenges WHERE expires_at < ${Date.now()}`;
    },
    async createSession(session: Session) {
      await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${session.id}, ${session.userId}, ${session.expiresAt})`;
    },
    async getSession(id: string) {
      const rows = await sql`SELECT * FROM sessions WHERE id = ${id}`;
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id as string,
        userId: r.user_id as string,
        expiresAt: Number(r.expires_at),
      };
    },
    async deleteSession(id: string) {
      await sql`DELETE FROM sessions WHERE id = ${id}`;
    },
  };

  return adapter;
}
