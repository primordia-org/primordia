// lib/db/index.ts — Factory that returns the SQLite DB adapter.
// bun:sqlite is used in both local development and exe.dev production.

import type { DbAdapter } from "./types";

let _db: DbAdapter | null = null;
let _resetting: Promise<void> | null = null;

export async function getDb(): Promise<DbAdapter> {
  if (_resetting) await _resetting;
  if (_db) return _db;

  const { createSqliteAdapter } = await import("./sqlite");
  _db = await createSqliteAdapter();
  return _db;
}

export async function resetDbForSqliteHotswap(): Promise<void> {
  await withSqliteDbHotswap(async () => {});
}

export async function withSqliteDbHotswap(operation: () => void | Promise<void>): Promise<void> {
  _resetting = (async () => {
    const { resetSqliteAdapter } = await import("./sqlite");
    resetSqliteAdapter();
    _db = null;
    await operation();
    resetSqliteAdapter();
    _db = null;
  })();
  try {
    await _resetting;
  } finally {
    _resetting = null;
  }
}
