// lib/db/index.ts — Factory that returns the SQLite DB adapter.
// bun:sqlite is used in both local development and exe.dev production.

import type { DbAdapter } from "./types";

let _db: DbAdapter | null = null;

export async function getDb(): Promise<DbAdapter> {
  if (_db) return _db;

  const { createSqliteAdapter } = await import("./sqlite");
  _db = await createSqliteAdapter();
  return _db;
}
