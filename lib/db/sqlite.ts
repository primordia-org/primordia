// lib/db/sqlite.ts — SQLite database adapter for local development (Bun runtime)
// Uses bun:sqlite which is built into Bun and requires no npm package.
// Only imported when DATABASE_URL is not set (i.e., local dev without Neon).

import type { DbAdapter, User, Passkey, Challenge, Session, CrossDeviceToken, EvolveSession } from "./types";

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
    CREATE TABLE IF NOT EXISTS cross_device_tokens (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      user_id TEXT,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evolve_sessions (
      id TEXT PRIMARY KEY,
      branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'starting',
      progress_text TEXT NOT NULL DEFAULT '',
      port INTEGER,
      preview_url TEXT,
      dev_server_pid INTEGER,
      request TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
  `);

  // Migration: add dev_server_pid to existing databases that pre-date this column.
  try {
    db.exec(`ALTER TABLE evolve_sessions ADD COLUMN dev_server_pid INTEGER`);
  } catch {
    // Column already exists — this is expected for databases created after the migration.
  }

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
    async createCrossDeviceToken(token: CrossDeviceToken) {
      db.prepare(
        "INSERT INTO cross_device_tokens (id, status, user_id, expires_at) VALUES (?, ?, ?, ?)"
      ).run(token.id, token.status, token.userId ?? null, token.expiresAt);
    },
    async getCrossDeviceToken(id: string) {
      const r = db
        .prepare("SELECT * FROM cross_device_tokens WHERE id = ?")
        .get(id) as {
        id: string;
        status: string;
        user_id: string | null;
        expires_at: number;
      } | null;
      if (!r) return null;
      return {
        id: r.id,
        status: r.status as CrossDeviceToken["status"],
        userId: r.user_id,
        expiresAt: r.expires_at,
      };
    },
    async approveCrossDeviceToken(id: string, userId: string) {
      db.prepare(
        "UPDATE cross_device_tokens SET status = 'approved', user_id = ? WHERE id = ?"
      ).run(userId, id);
    },
    async deleteCrossDeviceToken(id: string) {
      db.prepare("DELETE FROM cross_device_tokens WHERE id = ?").run(id);
    },
    async deleteExpiredCrossDeviceTokens() {
      db.prepare(
        "DELETE FROM cross_device_tokens WHERE expires_at < ?"
      ).run(Date.now());
    },

    // ── Evolve sessions ──────────────────────────────────────────────────────

    async createEvolveSession(session: EvolveSession) {
      db.prepare(
        `INSERT INTO evolve_sessions
           (id, branch, worktree_path, status, progress_text, port, preview_url, dev_server_pid, request, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        session.id,
        session.branch,
        session.worktreePath,
        session.status,
        session.progressText,
        session.port ?? null,
        session.previewUrl ?? null,
        session.devServerPid ?? null,
        session.request,
        session.createdAt,
      );
    },

    async updateEvolveSession(
      id: string,
      updates: Partial<Pick<EvolveSession, "status" | "progressText" | "port" | "previewUrl" | "devServerPid">>,
    ) {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (updates.status !== undefined)       { sets.push("status = ?");          values.push(updates.status); }
      if (updates.progressText !== undefined)  { sets.push("progress_text = ?");   values.push(updates.progressText); }
      if (updates.port !== undefined)          { sets.push("port = ?");             values.push(updates.port); }
      if (updates.previewUrl !== undefined)    { sets.push("preview_url = ?");      values.push(updates.previewUrl); }
      if (updates.devServerPid !== undefined)  { sets.push("dev_server_pid = ?");   values.push(updates.devServerPid); }
      if (sets.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE evolve_sessions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    },

    async getEvolveSession(id: string) {
      const r = db
        .prepare("SELECT * FROM evolve_sessions WHERE id = ?")
        .get(id) as {
        id: string; branch: string; worktree_path: string; status: string;
        progress_text: string; port: number | null; preview_url: string | null;
        dev_server_pid: number | null; request: string; created_at: number;
      } | null;
      if (!r) return null;
      return {
        id: r.id,
        branch: r.branch,
        worktreePath: r.worktree_path,
        status: r.status,
        progressText: r.progress_text,
        port: r.port,
        previewUrl: r.preview_url,
        devServerPid: r.dev_server_pid,
        request: r.request,
        createdAt: r.created_at,
      };
    },

    async listEvolveSessions(limit = 50) {
      const rows = db
        .prepare("SELECT * FROM evolve_sessions ORDER BY created_at DESC LIMIT ?")
        .all(limit) as Array<{
        id: string; branch: string; worktree_path: string; status: string;
        progress_text: string; port: number | null; preview_url: string | null;
        dev_server_pid: number | null; request: string; created_at: number;
      }>;
      return rows.map((r) => ({
        id: r.id,
        branch: r.branch,
        worktreePath: r.worktree_path,
        status: r.status,
        progressText: r.progress_text,
        port: r.port,
        previewUrl: r.preview_url,
        devServerPid: r.dev_server_pid,
        request: r.request,
        createdAt: r.created_at,
      }));
    },
  };

  dbInstance = adapter;
  return adapter;
}
