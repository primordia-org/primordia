// app/api/rollback/route.ts
// Fast rollback for the blue/green deploy: swaps 'current' back to 'previous'
// and restarts the systemd service. Admin-only.
//
// GET  — returns { hasPrevious: boolean } so the UI can show/hide the rollback option.
// POST — performs the rollback; returns { outcome: 'rolled-back' } or { error }.

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getSessionUser, isAdmin } from '../../../lib/auth';

const DB_NAME = '.primordia-auth.db';

/**
 * Finds the 'current' symlink by looking in the parent directory of process.cwd().
 * Works when the server is running from a worktree slot (e.g. primordia-worktrees/some-slot).
 * Returns null when the blue/green infrastructure is not set up.
 */
function findCurrentSymlink(): string | null {
  const candidate = path.join(path.dirname(process.cwd()), 'current');
  try {
    return fs.lstatSync(candidate).isSymbolicLink() ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Copies the SQLite database (plus WAL/SHM companion files) from src to dst.
 * Stale companion files in dst that are absent in src are deleted so SQLite
 * doesn't misinterpret them after the copy.
 */
function copyDb(srcDir: string, dstDir: string): void {
  const srcDb = path.join(srcDir, DB_NAME);
  if (!fs.existsSync(srcDb)) return;
  fs.copyFileSync(srcDb, path.join(dstDir, DB_NAME));
  for (const ext of ['-wal', '-shm']) {
    const src = srcDb + ext;
    const dst = path.join(dstDir, DB_NAME) + ext;
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    } else {
      fs.rmSync(dst, { force: true });
    }
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: 'Admin required' }, { status: 403 });

  const currentSymlink = findCurrentSymlink();
  if (!currentSymlink) return Response.json({ hasPrevious: false });

  const previousSymlink = path.join(path.dirname(currentSymlink), 'previous');
  try {
    if (fs.lstatSync(previousSymlink).isSymbolicLink()) {
      return Response.json({ hasPrevious: true });
    }
  } catch { /* not present */ }
  return Response.json({ hasPrevious: false });
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: 'Admin required' }, { status: 403 });

  const currentSymlink = findCurrentSymlink();
  if (!currentSymlink) {
    return Response.json(
      { error: 'Blue/green infrastructure not found — no current symlink.' },
      { status: 400 },
    );
  }

  const previousSymlink = path.join(path.dirname(currentSymlink), 'previous');
  let previousTarget: string;
  try {
    previousTarget = path.resolve(fs.readlinkSync(previousSymlink));
  } catch {
    return Response.json({ error: 'No previous slot available for rollback.' }, { status: 400 });
  }

  const currentTarget = path.resolve(fs.readlinkSync(currentSymlink));

  // Copy the production DB from the current slot into the previous slot so auth
  // data and user sessions are preserved after rolling back.
  try {
    copyDb(currentTarget, previousTarget);
  } catch {
    // Non-fatal: proceed with the rollback even if the DB copy fails.
  }

  // Atomically swap: current ← previousTarget, previous ← currentTarget.
  const tmpCurrent = currentSymlink + '.tmp';
  fs.symlinkSync(previousTarget, tmpCurrent);
  fs.renameSync(tmpCurrent, currentSymlink);

  const tmpPrevious = previousSymlink + '.tmp';
  fs.symlinkSync(currentTarget, tmpPrevious);
  fs.renameSync(tmpPrevious, previousSymlink);

  // Restart the service on the now-active (rolled-back) slot.
  // Fire-and-forget with a short delay so the HTTP response flushes first.
  setTimeout(() => {
    try { execSync('sudo systemctl restart primordia', { stdio: 'ignore' }); } catch { /* best-effort */ }
  }, 500);

  return Response.json({ outcome: 'rolled-back' });
}
