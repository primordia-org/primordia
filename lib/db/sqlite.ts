// lib/db/sqlite.ts — SQLite database adapter for local development (Bun runtime)
// Uses bun:sqlite which is built into Bun and requires no npm package.
// Only imported when DATABASE_URL is not set (i.e., local dev without Neon).

import type { DbAdapter, Role, User, Passkey, Challenge, Session, CrossDeviceToken, InstanceConfig, GraphNode, GraphEdge } from "./types";
import { generateUuid7 } from "../uuid7";

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
    CREATE TABLE IF NOT EXISTS roles (
      name TEXT PRIMARY KEY,
      id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT NOT NULL REFERENCES users(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS instance_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS graph_nodes (
      uuid7 TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      registered_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      from_uuid TEXT NOT NULL,
      to_uuid TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'fork',
      date TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id),
      role_name TEXT NOT NULL REFERENCES roles(name),
      granted_by TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, role_name)
    );
  `);

  // Migration: add id and display_name columns to roles (added when roles got UUIDs + customizable names)
  // Must run before the seed inserts below so existing DBs have the columns ready.
  try {
    db.exec("ALTER TABLE roles ADD COLUMN id TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec("ALTER TABLE roles ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists — ignore
  }

  // Seed built-in roles
  const now = Date.now();
  db.prepare(
    "INSERT OR IGNORE INTO roles (name, id, display_name, description, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run("admin", crypto.randomUUID(), "Prime", "Owner/admin role with full system access", now);
  db.prepare(
    "INSERT OR IGNORE INTO roles (name, id, display_name, description, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run("can_evolve", crypto.randomUUID(), "Evolver", "Permission to propose changes to the app via the evolve flow", now);

  // Migration: grant admin role to first user if they don't have it yet
  try {
    db.exec(`
      INSERT OR IGNORE INTO user_roles (user_id, role_name, granted_by, granted_at)
      SELECT u.id, 'admin', 'system', ${now}
      FROM users u
      ORDER BY u.created_at ASC
      LIMIT 1
    `);
  } catch {
    // First user doesn't exist yet — ignore
  }

  // Bootstrap instance identity — generate uuid7 on first run
  const existingUuid = db.prepare("SELECT value FROM instance_config WHERE key = 'uuid7'").get() as { value: string } | null;
  if (!existingUuid) {
    const uuid7 = generateUuid7();
    const insert = db.prepare("INSERT OR IGNORE INTO instance_config (key, value) VALUES (?, ?)");
    insert.run("uuid7", uuid7);
    insert.run("name", "My Primordia");
    insert.run("description", "A Primordia instance");
    insert.run("canonical_url", "");
    insert.run("parent_url", "");
  } else {
    // Migration: ensure canonical_url and parent_url keys exist for older DBs
    const upsertKey = db.prepare("INSERT OR IGNORE INTO instance_config (key, value) VALUES (?, ?)");
    upsertKey.run("canonical_url", "");
    upsertKey.run("parent_url", "");
  }

  // Migration: port existing user_permissions rows to user_roles (one-time, idempotent)
  try {
    db.exec(`
      INSERT OR IGNORE INTO user_roles (user_id, role_name, granted_by, granted_at)
      SELECT user_id, permission, granted_by, granted_at FROM user_permissions
    `);
  } catch {
    // user_permissions table may not exist on fresh installs — ignore
  }
  // Backfill: assign UUIDs and display names to existing built-in roles that are missing them
  const adminRole = db.prepare("SELECT id, display_name FROM roles WHERE name = 'admin'").get() as
    | { id: string; display_name: string } | null;
  if (adminRole && (!adminRole.id || adminRole.id === '')) {
    db.prepare("UPDATE roles SET id = ? WHERE name = 'admin'").run(crypto.randomUUID());
  }
  if (adminRole && (!adminRole.display_name || adminRole.display_name === '')) {
    db.prepare("UPDATE roles SET display_name = ? WHERE name = 'admin'").run("Prime");
  }
  const evolveRole = db.prepare("SELECT id, display_name FROM roles WHERE name = 'can_evolve'").get() as
    | { id: string; display_name: string } | null;
  if (evolveRole && (!evolveRole.id || evolveRole.id === '')) {
    db.prepare("UPDATE roles SET id = ? WHERE name = 'can_evolve'").run(crypto.randomUUID());
  }
  if (evolveRole && (!evolveRole.display_name || evolveRole.display_name === '')) {
    db.prepare("UPDATE roles SET display_name = ? WHERE name = 'can_evolve'").run("Evolver");
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
    async getAllUsers() {
      const rows = db
        .prepare("SELECT * FROM users ORDER BY created_at ASC")
        .all() as Array<{ id: string; username: string; created_at: number }>;
      return rows.map((r) => ({ id: r.id, username: r.username, createdAt: r.created_at }));
    },
    async getFirstUser() {
      const row = db
        .prepare("SELECT * FROM users ORDER BY created_at ASC LIMIT 1")
        .get() as { id: string; username: string; created_at: number } | null;
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

    // ── Roles (RBAC) ─────────────────────────────────────────────────────────

    async getAllRoles() {
      const rows = db
        .prepare("SELECT name, id, display_name, description, created_at FROM roles ORDER BY created_at ASC")
        .all() as Array<{ name: string; id: string; display_name: string; description: string; created_at: number }>;
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        displayName: r.display_name,
        description: r.description,
        createdAt: r.created_at,
      }));
    },
    async grantRole(userId: string, roleName: string, grantedBy: string) {
      db.prepare(
        `INSERT OR REPLACE INTO user_roles (user_id, role_name, granted_by, granted_at)
         VALUES (?, ?, ?, ?)`
      ).run(userId, roleName, grantedBy, Date.now());
    },
    async revokeRole(userId: string, roleName: string) {
      db.prepare(
        "DELETE FROM user_roles WHERE user_id = ? AND role_name = ?"
      ).run(userId, roleName);
    },
    async getUserRoles(userId: string) {
      const rows = db
        .prepare("SELECT role_name FROM user_roles WHERE user_id = ?")
        .all(userId) as Array<{ role_name: string }>;
      return rows.map((r) => r.role_name);
    },
    async getUsersWithRole(roleName: string) {
      const rows = db
        .prepare("SELECT user_id FROM user_roles WHERE role_name = ?")
        .all(roleName) as Array<{ user_id: string }>;
      return rows.map((r) => r.user_id);
    },

    // ── User preferences ─────────────────────────────────────────────────────

    async getUserPreferences(userId: string, keys: string[]) {
      if (keys.length === 0) return {};
      const placeholders = keys.map(() => '?').join(', ');
      const rows = db
        .prepare(`SELECT key, value FROM user_preferences WHERE user_id = ? AND key IN (${placeholders})`)
        .all(userId, ...keys) as Array<{ key: string; value: string }>;
      const result: Record<string, string> = {};
      for (const r of rows) result[r.key] = r.value;
      return result;
    },
    async setUserPreferences(userId: string, prefs: Record<string, string>) {
      const now = Date.now();
      const upsert = db.prepare(
        `INSERT INTO user_preferences (user_id, key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      );
      db.exec('BEGIN');
      try {
        for (const [key, value] of Object.entries(prefs)) {
          upsert.run(userId, key, value, now);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },


    // ── Instance identity & social graph ─────────────────────────────────────

    async getInstanceConfig() {
      const rows = db
        .prepare("SELECT key, value FROM instance_config")
        .all() as Array<{ key: string; value: string }>;
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value;
      return {
        uuid7: map["uuid7"] ?? "",
        name: map["name"] ?? "My Primordia",
        description: map["description"] ?? "",
        canonicalUrl: map["canonical_url"] ?? "",
        parentUrl: map["parent_url"] ?? "",
      } as InstanceConfig;
    },

    async setInstanceConfig(fields) {
      const upsert = db.prepare(
        "INSERT INTO instance_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
      );
      if (fields.name !== undefined) upsert.run("name", fields.name);
      if (fields.description !== undefined) upsert.run("description", fields.description);
      if (fields.canonicalUrl !== undefined) upsert.run("canonical_url", fields.canonicalUrl);
      if (fields.parentUrl !== undefined) upsert.run("parent_url", fields.parentUrl);
    },

    async getGraphNodes() {
      const rows = db
        .prepare("SELECT uuid7, url, name, description, registered_at FROM graph_nodes ORDER BY registered_at ASC")
        .all() as Array<{ uuid7: string; url: string; name: string; description: string | null; registered_at: number }>;
      return rows.map((r) => ({
        uuid7: r.uuid7,
        url: r.url,
        name: r.name,
        description: r.description,
        registeredAt: r.registered_at,
      }));
    },

    async upsertGraphNode(node: GraphNode) {
      db.prepare(
        `INSERT INTO graph_nodes (uuid7, url, name, description, registered_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (uuid7) DO UPDATE SET url = excluded.url, name = excluded.name,
           description = excluded.description, registered_at = excluded.registered_at`
      ).run(node.uuid7, node.url, node.name, node.description ?? null, node.registeredAt);
    },

    async getGraphEdges() {
      const rows = db
        .prepare("SELECT id, from_uuid, to_uuid, type, date, created_at FROM graph_edges ORDER BY created_at ASC")
        .all() as Array<{ id: string; from_uuid: string; to_uuid: string; type: string; date: string; created_at: number }>;
      return rows.map((r) => ({
        id: r.id,
        from: r.from_uuid,
        to: r.to_uuid,
        type: r.type,
        date: r.date,
        createdAt: r.created_at,
      }));
    },

    async upsertGraphEdge(edge: GraphEdge) {
      db.prepare(
        `INSERT INTO graph_edges (id, from_uuid, to_uuid, type, date, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET type = excluded.type, date = excluded.date`
      ).run(edge.id, edge.from, edge.to, edge.type, edge.date, edge.createdAt);
    },

  };

  dbInstance = adapter;
  return adapter;
}
