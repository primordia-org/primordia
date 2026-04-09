// app/api/rollback/route.ts
// Fast rollback for the blue/green deploy: swaps production back to the previous
// slot (second entry in primordia.productionHistory) with zero downtime via the
// reverse proxy. Admin-only.
//
// GET  — returns { hasPrevious: boolean } so the UI can show/hide the rollback option.
// POST — performs the rollback; returns { outcome: 'rolled-back' } or { error }.

import { execSync, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { Database } from 'bun:sqlite';
import { getSessionUser, isAdmin } from '../../../lib/auth';

const DB_NAME = '.primordia-auth.db';

interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
}

function parseWorktreeList(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) worktrees.push({ branch: null, head: '', ...current } as WorktreeInfo);
      current = { path: line.slice('worktree '.length), head: '', branch: null };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    }
    // 'detached' line: branch stays null
  }
  if (current.path) worktrees.push({ branch: null, head: '', ...current } as WorktreeInfo);
  return worktrees;
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

function findCurrentAndPrevious(repoRoot: string): {
  currentTarget: string;
  previousTarget: string;
  previousBranch: string;
  prodBranch: string;
} | { error: string } {
  // Current prod branch from git config.
  const prodBranch = spawnSync('git', ['config', '--get', 'primordia.productionBranch'], {
    cwd: repoRoot, encoding: 'utf8',
  }).stdout.trim();
  if (!prodBranch) return { error: 'primordia.productionBranch is not set in git config.' };

  // Previous production branch from primordia.productionHistory (oldest-first; reverse for newest-first).
  const historyOut = spawnSync('git', ['config', '--get-all', 'primordia.productionHistory'], {
    cwd: repoRoot, encoding: 'utf8',
  }).stdout.trim();
  const historyBranches = historyOut.split('\n').filter(Boolean).reverse();
  if (historyBranches.length < 2) {
    return { error: 'No previous slot in production history (primordia.productionHistory has fewer than 2 entries).' };
  }
  const previousBranch = historyBranches[1];

  const worktrees = parseWorktreeList(
    spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).stdout,
  );

  const currentWorktree = worktrees.find(wt => wt.branch === prodBranch);
  if (!currentWorktree) return { error: `No worktree found for production branch '${prodBranch}'.` };

  const previousWorktree = worktrees.find(
    wt => wt.branch === previousBranch && wt.path !== currentWorktree.path,
  );
  if (!previousWorktree?.branch) {
    return { error: `No worktree found for previous production branch '${previousBranch}' (may have been pruned).` };
  }

  return {
    currentTarget: currentWorktree.path,
    previousTarget: previousWorktree.path,
    previousBranch: previousWorktree.branch,
    prodBranch,
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: 'Admin required' }, { status: 403 });

  const result = findCurrentAndPrevious(process.cwd());
  const hasPrevious = !('error' in result);
  return Response.json({ hasPrevious });
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: 'Admin required' }, { status: 403 });

  const repoRoot = process.cwd();
  const slots = findCurrentAndPrevious(repoRoot);
  if ('error' in slots) {
    return Response.json({ error: slots.error }, { status: 400 });
  }
  const { currentTarget, previousTarget, previousBranch, prodBranch } = slots;

  // Copy the production DB from the current slot into the previous slot so auth
  // data and user sessions are preserved after rolling back.
  try {
    copyDb(currentTarget, previousTarget);
  } catch {
    // Non-fatal: proceed with the rollback even if the DB copy fails.
  }

  // Read the old upstream port (current production).
  let oldUpstreamPort: number | null = null;
  try {
    const portOut = spawnSync('git', ['config', '--get', `branch.${prodBranch}.port`], {
      cwd: repoRoot, encoding: 'utf8',
    }).stdout.trim();
    if (portOut) oldUpstreamPort = parseInt(portOut, 10);
  } catch { /* best-effort */ }

  // Zero-downtime restart via proxy: start the rolled-back slot on a free port,
  // wait for health, then update git config for the proxy to cut over instantly.
  void (async () => {
    const freePort: number = await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        s.close(() => resolve(port));
      });
      s.on('error', reject);
    });

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
      try { newServer.kill('SIGTERM'); } catch {}
      return;
    }

    // Update production branch in git config; touch port to fire proxy's fs.watch.
    spawnSync('git', ['config', 'primordia.productionBranch', previousBranch], { cwd: repoRoot });
    spawnSync('git', ['config', '--add', 'primordia.productionHistory', previousBranch], { cwd: repoRoot });
    spawnSync('git', ['config', `branch.${previousBranch}.port`, String(freePort)], { cwd: repoRoot });

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

  return Response.json({ outcome: 'rolled-back' });
}
