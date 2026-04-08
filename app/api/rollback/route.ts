// app/api/rollback/route.ts
// Fast rollback for the blue/green deploy: swaps 'current' back to 'previous'
// and restarts the systemd service. Admin-only.
//
// GET  — returns { hasPrevious: boolean } so the UI can show/hide the rollback option.
// POST — performs the rollback; returns { outcome: 'rolled-back' } or { error }.

import { execSync, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Database } from 'bun:sqlite';
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
 * Creates a consistent point-in-time snapshot of the SQLite DB using
 * VACUUM INTO — safe while the source DB is being actively written to.
 */
function copyDb(srcDir: string, dstDir: string): void {
  const srcDb = path.join(srcDir, DB_NAME);
  if (!fs.existsSync(srcDb)) return;
  const dstDb = path.join(dstDir, DB_NAME);
  // VACUUM INTO fails if the destination file already exists
  fs.rmSync(dstDb, { force: true });
  fs.rmSync(dstDb + '-wal', { force: true });
  fs.rmSync(dstDb + '-shm', { force: true });
  const db = new Database(srcDb);
  try {
    db.prepare('VACUUM INTO ?').run(dstDb);
  } finally {
    db.close();
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

  // Both slots remain on their own session branches after the symlink swap —
  // no HEAD-reattachment needed. The proxy is updated via PROD symbolic-ref below.

  // Zero-downtime restart when the proxy is configured.
  const reverseProxyPort = process.env.REVERSE_PROXY_PORT;
  if (reverseProxyPort) {
    // Start the rolled-back slot on a free port, wait for health, then cut over.
    void (async () => {
      const net = await import('net');

      const freePort: number = await new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => {
          const addr = s.address();
          const port = typeof addr === 'object' && addr ? addr.port : 0;
          s.close(() => resolve(port));
        });
        s.on('error', reject);
      });

      // Read the old production port from PROD symbolic-ref (the slot we're
      // rolling back away from). Fall back to HEAD of currentTarget for
      // pre-PROD deployments. currentTarget is the OLD production slot —
      // now pointed to by 'previous' after the swap.
      let oldUpstreamPort: number | null = null;
      try {
        let prodBranch = spawnSync('git', ['symbolic-ref', '--short', 'PROD'], {
          cwd: currentTarget,
          encoding: 'utf8',
        }).stdout.trim();
        if (!prodBranch) {
          prodBranch = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], {
            cwd: currentTarget,
            encoding: 'utf8',
          }).stdout.trim();
        }
        if (prodBranch) {
          const portOut = spawnSync('git', ['config', '--get', `branch.${prodBranch}.port`], {
            cwd: currentTarget,
            encoding: 'utf8',
          }).stdout.trim();
          if (portOut) oldUpstreamPort = parseInt(portOut, 10);
        }
      } catch { /* best-effort */ }

      const newServer = spawn('bun', ['run', 'start'], {
        cwd: previousTarget,
        env: { ...process.env, PORT: String(freePort), HOSTNAME: '0.0.0.0' },
        stdio: 'ignore',
        detached: true,
      });
      newServer.unref();

      // Health check for up to 30 s
      const deadline = Date.now() + 30_000;
      let healthy = false;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1_000));
        try {
          await fetch(`http://localhost:${freePort}/`, {
            signal: AbortSignal.timeout(3_000),
            redirect: 'manual',
          });
          healthy = true;
          break;
        } catch { /* not ready yet */ }
      }

      if (!healthy) {
        // Fall back to systemctl restart on health-check failure
        try { newServer.kill('SIGTERM'); } catch {}
        try { execSync('sudo systemctl restart primordia', { stdio: 'ignore' }); } catch {}
        return;
      }

      // Set PROD → rolled-back branch and update its port in git config.
      // The port write touches .git/config and fires the proxy's fs.watch so
      // it reads the updated PROD ref immediately.
      try {
        const rolledBackPath = path.resolve(fs.readlinkSync(currentSymlink));
        const branch = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], {
          cwd: rolledBackPath,
          encoding: 'utf8',
        }).stdout.trim();
        if (branch) {
          spawnSync('git', ['symbolic-ref', 'PROD', `refs/heads/${branch}`], {
            cwd: rolledBackPath,
          });
          spawnSync('git', ['config', `branch.${branch}.port`, String(freePort)], {
            cwd: rolledBackPath,
          });
        }
      } catch { /* best-effort */ }

      // Give the proxy ~500 ms to pick up the config, then kill the old server
      setTimeout(() => {
        if (oldUpstreamPort !== null) {
          try {
            const pids = execSync(`lsof -ti tcp:${oldUpstreamPort}`, { encoding: 'utf8' })
              .trim().split('\n').filter(Boolean).map(Number).filter(Boolean);
            for (const pid of pids) {
              try { process.kill(pid, 'SIGTERM'); } catch {}
            }
          } catch {}
        }
      }, 500);
    })();
  } else {
    // Fallback: brief-downtime systemctl restart
    setTimeout(() => {
      try { execSync('sudo systemctl restart primordia', { stdio: 'ignore' }); } catch {}
    }, 500);
  }

  return Response.json({ outcome: 'rolled-back' });
}
