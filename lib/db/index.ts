// lib/db/index.ts — Factory that returns the right DB adapter based on environment.
// - DATABASE_URL set → Neon (Vercel production)
// - DATABASE_URL not set → bun:sqlite (local Bun dev)

import type { DbAdapter } from "./types";

let _db: DbAdapter | null = null;

export async function getDb(): Promise<DbAdapter> {
  if (_db) return _db;

  if (process.env.DATABASE_URL) {
    const { createNeonAdapter } = await import("./neon");
    _db = await createNeonAdapter();
  } else {
    const { createSqliteAdapter } = await import("./sqlite");
    _db = await createSqliteAdapter();
  }
  return _db;
}
