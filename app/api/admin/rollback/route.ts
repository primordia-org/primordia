// app/api/admin/rollback/route.ts
// Deep rollback: list available production slots from PROD git reflog and apply one.
// Admin-only.
//
// GET  — returns { currentBranch, targets[] } where targets are previous prod slots
//        matched from the PROD symbolic-ref reflog against registered git worktrees.
// POST — { worktreePath } starts a health-checked server in the target worktree,
//        updates git config slot tracker, updates PROD, and gracefully kills the old server.

import { spawnSync, spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { Database } from 'bun:sqlite';
import { getSessionUser, isAdmin } from '@/lib/auth';

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

function copyDb(srcDir: string, dstDir: string): void {
  const srcDb = path.join(srcDir, DB_NAME);
  if (!fs.existsSync(srcDb)) return;
  const dstDb = path.join(dstDir, DB_NAME);
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

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: 'Admin required' }, { status: 403 });

  const repoRoot = process.cwd();

  // Current PROD branch
  const prodResult = spawnSync('git', ['symbolic-ref', '--short', 'PROD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const currentBranch = prodResult.stdout.trim() || null;

  // PROD reflog OIDs (newest-first; index 0 = current production)
  const reflogResult = spawnSync('git', ['log', '-g', '--format=%H', 'PROD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const reflogHashes = reflogResult.stdout.trim().split('\n').filter(Boolean);

  // All registered worktrees
  const wtListResult = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const worktrees = parseWorktreeList(wtListResult.stdout);

  // HEAD hash → worktree
  const hashToWorktree = new Map<string, WorktreeInfo>();
  for (const wt of worktrees) {
    if (wt.head) hashToWorktree.set(wt.head, wt);
  }

  // Current prod path — the worktree on the PROD branch.
  const currentPath = (() => {
    for (const wt of worktrees) {
      if (wt.branch === currentBranch) return wt.path;
    }
    return null;
  })();

  // Build targets from reflog entries after index 0, matched to existing worktrees
  const targets: Array<{ branch: string; worktreePath: string; reflogIndex: number }> = [];
  const seenPaths = new Set<string>();
  for (let i = 1; i < reflogHashes.length; i++) {
    const wt = hashToWorktree.get(reflogHashes[i]);
    if (!wt || !wt.branch) continue;
    if (wt.path === currentPath) continue;
    if (seenPaths.has(wt.path)) continue;
    seenPaths.add(wt.path);
    targets.push({ branch: wt.branch, worktreePath: wt.path, reflogIndex: i });
  }

  return Response.json({ currentBranch, targets });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: 'Admin required' }, { status: 403 });

  let body: { worktreePath?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { worktreePath } = body;
  if (!worktreePath) {
    return Response.json({ error: 'worktreePath is required' }, { status: 400 });
  }

  const repoRoot = process.cwd();

  // Security: verify the target is a registered git worktree
  const wtListResult = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const worktrees = parseWorktreeList(wtListResult.stdout);
  const targetWorktree = worktrees.find(wt => wt.path === path.resolve(worktreePath));
  if (!targetWorktree?.branch) {
    return Response.json({ error: 'Target is not a valid registered worktree.' }, { status: 400 });
  }

  const targetPath = targetWorktree.path;

  // Current prod slot = worktree on the PROD branch.
  const currentProdBranch = spawnSync('git', ['symbolic-ref', '--short', 'PROD'], {
    cwd: repoRoot, encoding: 'utf8',
  }).stdout.trim();
  if (!currentProdBranch) {
    return Response.json({ error: 'PROD symbolic-ref is not set.' }, { status: 400 });
  }
  const currentProdWorktree = worktrees.find(wt => wt.branch === currentProdBranch);
  if (!currentProdWorktree) {
    return Response.json({ error: 'Current production worktree not found.' }, { status: 400 });
  }
  const currentTarget = currentProdWorktree.path;

  if (targetPath === currentTarget) {
    return Response.json({ error: 'Target is already the current production slot.' }, { status: 400 });
  }

  // Read old upstream port before doing anything
  let oldUpstreamPort: number | null = null;
  try {
    let prodBranch = spawnSync('git', ['symbolic-ref', '--short', 'PROD'], {
      cwd: repoRoot, encoding: 'utf8',
    }).stdout.trim();
    if (!prodBranch) {
      prodBranch = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], {
        cwd: currentTarget, encoding: 'utf8',
      }).stdout.trim();
    }
    if (prodBranch) {
      const portOut = spawnSync('git', ['config', '--get', `branch.${prodBranch}.port`], {
        cwd: repoRoot, encoding: 'utf8',
      }).stdout.trim();
      if (portOut) oldUpstreamPort = parseInt(portOut, 10);
    }
  } catch { /* best-effort */ }

  // Copy DB from current into target slot (preserves auth/session data)
  try {
    copyDb(currentTarget, targetPath);
  } catch { /* non-fatal */ }

  const reverseProxyPort = process.env.REVERSE_PROXY_PORT;

  if (reverseProxyPort) {
    // Zero-downtime path: start target server, health-check, then swap
    void (async () => {
      const freePort = await findFreePort();

      const newServer = spawn('bun', ['run', 'start'], {
        cwd: targetPath,
        env: { ...process.env, PORT: String(freePort), HOSTNAME: '0.0.0.0' },
        stdio: 'ignore',
        detached: true,
      });
      newServer.unref();

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
        try { execSync('sudo systemctl restart primordia-proxy', { stdio: 'ignore' }); } catch {}
        return;
      }

      // Update PROD symbolic-ref and branch port → proxy picks up instantly
      try {
        spawnSync('git', ['symbolic-ref', 'PROD', `refs/heads/${targetWorktree.branch}`], { cwd: repoRoot });
        spawnSync('git', ['config', `branch.${targetWorktree.branch}.port`, String(freePort)], { cwd: repoRoot });
      } catch { /* best-effort */ }

      // Kill old server after proxy has time to pick up changes
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
    // Brief-downtime path: update slot tracker then restart.
    spawnSync('git', ['symbolic-ref', 'PROD', `refs/heads/${targetWorktree.branch}`], { cwd: repoRoot });
    setTimeout(() => {
      try { execSync('sudo systemctl restart primordia-proxy', { stdio: 'ignore' }); } catch {}
    }, 500);
  }

  return Response.json({ outcome: 'rolling-back' });
}
