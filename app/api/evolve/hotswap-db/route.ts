// app/api/evolve/hotswap-db/route.ts
// Internal-only helper used by the parent server to replace a running preview
// server's SQLite DB without swapping the file out from under an open handle.

import * as fs from 'fs';
import * as path from 'path';
import { withSqliteDbHotswap } from '@/lib/db';

function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const hostname = host.split(':')[0]?.toLowerCase();
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
}

export async function POST(request: Request) {
  if (!isLoopbackHost(request.headers.get('host'))) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { snapshotFilename?: string } | null;
  const snapshotFilename = body?.snapshotFilename;
  if (!snapshotFilename) {
    return Response.json({ error: 'snapshotFilename is required' }, { status: 400 });
  }

  const basename = path.basename(snapshotFilename);
  if (basename !== snapshotFilename || !basename.startsWith('.primordia-auth.db.hotswap-')) {
    return Response.json({ error: 'Invalid snapshotFilename' }, { status: 400 });
  }

  const cwd = process.cwd();
  const snapshotPath = path.join(cwd, basename);
  const dbPath = path.join(cwd, '.primordia-auth.db');
  if (!fs.existsSync(snapshotPath)) {
    return Response.json({ error: 'Snapshot not found' }, { status: 404 });
  }

  try {
    await withSqliteDbHotswap(() => {
      for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        try { fs.unlinkSync(file); } catch { /* absent */ }
      }
      fs.renameSync(snapshotPath, dbPath);
    });
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
