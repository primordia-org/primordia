// lib/db/sqlite.ts — SQLite database adapter for local development (Bun runtime)
// Uses bun:sqlite which is built into Bun and requires no npm package.
// Only imported when DATABASE_URL is not set (i.e., local dev without Neon).

import type { DbAdapter, User, Passkey, Challenge, Session } from "./types";

let dbInstance: DbAdapter | null = null;

export async function createSqliteAdapter(): Promise<DbAdapter> {
  if (dbInstance) return dbInstance;

  // bun:sqlite is only available in the Bun runtime — dynamic import avoids
  // webpack bundling errors when building for Vercel (Node.js).
  const { Database } = await import("bun:sqlite");
  const db = new Database(".primordia-auth.db", { create: true });

  // WAL mode for better concurrent read performance
  db.exec("PRAGMA journal_mode=WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      credential_id TEXT NOT NULL UNIQUE,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      device_type TEXT NOT NULL,
      backed_up INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL
    );
  `);

  const adapter: DbAdapter = {
    async createUser(user: User) {
      db.prepare(
        "INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)"
      ).run(user.id, user.username, user.createdAt);
    },
    async getUserByUsername(username: string) {
      const row = db
        .prepare("SELECT * FROM users WHERE username = ?")
        .get(username) as {
        id: string;
        username: string;
        created_at: number;
      } | null;
      if (!row) return null;
      return { id: row.id, username: row.username, createdAt: row.created_at };
    },
    async getUserById(id: string) {
      const row = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(id) as { id: string; username: string; created_at: number } | null;
      if (!row) return null;
      return { id: row.id, username: row.username, createdAt: row.created_at };
    },
    async savePasskey(passkey: Passkey) {
      db.prepare(
        `INSERT INTO passkeys
           (id, user_id, credential_id, public_key, counter, device_type, backed_up, transports, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        passkey.id,
        passkey.userId,
        passkey.credentialId,
        passkey.publicKey,
        passkey.counter,
        passkey.deviceType,
        passkey.backedUp ? 1 : 0,
        passkey.transports ?? null,
        passkey.createdAt
      );
    },
    async getPasskeysByUserId(userId: string) {
      const rows = db
        .prepare("SELECT * FROM passkeys WHERE user_id = ?")
        .all(userId) as Array<{
        id: string;
        user_id: string;
        credential_id: string;
        public_key: Buffer;
        counter: number;
        device_type: string;
        backed_up: number;
        transports: string | null;
        created_at: number;
      }>;
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        credentialId: r.credential_id,
        publicKey: new Uint8Array(r.public_key),
        counter: r.counter,
        deviceType: r.device_type,
        backedUp: r.backed_up === 1,
        transports: r.transports,
        createdAt: r.created_at,
      }));
    },
    async getPasskeyByCredentialId(credentialId: string) {
      const r = db
        .prepare("SELECT * FROM passkeys WHERE credential_id = ?")
        .get(credentialId) as {
        id: string;
        user_id: string;
        credential_id: string;
        public_key: Buffer;
        counter: number;
        device_type: string;
        backed_up: number;
        transports: string | null;
        created_at: number;
      } | null;
      if (!r) return null;
      return {
        id: r.id,
        userId: r.user_id,
        credentialId: r.credential_id,
        publicKey: new Uint8Array(r.public_key),
        counter: r.counter,
        deviceType: r.device_type,
        backedUp: r.backed_up === 1,
        transports: r.transports,
        createdAt: r.created_at,
      };
    },
    async updatePasskeyCounter(credentialId: string, counter: number) {
      db.prepare(
        "UPDATE passkeys SET counter = ? WHERE credential_id = ?"
      ).run(counter, credentialId);
    },
    async saveChallenge(challenge: Challenge) {
      db.prepare(
        "INSERT INTO challenges (id, challenge, user_id, username, expires_at) VALUES (?, ?, ?, ?, ?)"
      ).run(
        challenge.id,
        challenge.challenge,
        challenge.userId ?? null,
        challenge.username ?? null,
        challenge.expiresAt
      );
    },
    async getChallenge(id: string) {
      const r = db
        .prepare("SELECT * FROM challenges WHERE id = ?")
        .get(id) as {
        id: string;
        challenge: string;
        user_id: string | null;
        username: string | null;
        expires_at: number;
      } | null;
      if (!r) return null;
      return {
        id: r.id,
        challenge: r.challenge,
        userId: r.user_id,
        username: r.username,
        expiresAt: r.expires_at,
      };
    },
    async deleteChallenge(id: string) {
      db.prepare("DELETE FROM challenges WHERE id = ?").run(id);
    },
    async deleteExpiredChallenges() {
      db.prepare("DELETE FROM challenges WHERE expires_at < ?").run(
        Date.now()
      );
    },
    async createSession(session: Session) {
      db.prepare(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
      ).run(session.id, session.userId, session.expiresAt);
    },
    async getSession(id: string) {
      const r = db
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .get(id) as {
        id: string;
        user_id: string;
        expires_at: number;
      } | null;
      if (!r) return null;
      return { id: r.id, userId: r.user_id, expiresAt: r.expires_at };
    },
    async deleteSession(id: string) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    },
  };

  dbInstance = adapter;
  return adapter;
}
