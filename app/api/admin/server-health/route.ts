// app/api/admin/server-health/route.ts
// Admin-only API for server resource usage and non-prod worktree cleanup.
//
// GET  — returns disk usage, memory usage, and oldest non-prod worktree info.
// POST — deletes the oldest non-prod worktree (removes worktree + deletes branch).

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getSessionUser, isAdmin } from '@/lib/auth';

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
  }
  if (current.path) worktrees.push({ branch: null, head: '', ...current } as WorktreeInfo);
  return worktrees;
}

interface DiskInfo {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
}

interface MemoryInfo {
  totalMB: number;
  usedMB: number;
  availableMB: number;
  usedPercent: number;
}

interface NonProdWorktree {
  path: string;
  branch: string;
  ctimeMs: number;
}

function getDiskInfo(): DiskInfo | null {
  try {
    const result = spawnSync('df', ['-B1', '/'], { encoding: 'utf8' });
    if (result.status !== 0) return null;
    const lines = result.stdout.trim().split('\n');
    // Some df outputs wrap long lines — join all non-header lines and split by whitespace
    const dataLine = lines.slice(1).join(' ').trim();
    const parts = dataLine.split(/\s+/);
    // parts: [filesystem, 1B-blocks, used, available, use%, mounted]
    if (parts.length < 4) return null;
    const totalBytes = parseInt(parts[1], 10);
    const usedBytes = parseInt(parts[2], 10);
    const availableBytes = parseInt(parts[3], 10);
    if (isNaN(totalBytes) || isNaN(usedBytes) || isNaN(availableBytes)) return null;
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
    return { totalBytes, usedBytes, availableBytes, usedPercent };
  } catch {
    return null;
  }
}

function getMemoryInfo(): MemoryInfo | null {
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (key: string): number => {
      const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
      return match ? parseInt(match[1], 10) : 0;
    };
    const totalKB = get('MemTotal');
    const freeKB = get('MemFree');
    const availableKB = get('MemAvailable');
    if (totalKB === 0) return null;
    const totalMB = Math.round(totalKB / 1024);
    const availableMB = Math.round(availableKB / 1024);
    const usedMB = totalMB - availableMB;
    const usedPercent = totalMB > 0 ? Math.round((usedMB / totalMB) * 100) : 0;
    return { totalMB, usedMB, availableMB, usedPercent };
  } catch {
    return null;
  }
}

function getOldestNonProdWorktree(repoRoot: string): NonProdWorktree | null {
  const wtResult = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (wtResult.status !== 0) return null;

  const worktrees = parseWorktreeList(wtResult.stdout);

  // The main worktree is the first entry (process.cwd()); exclude it.
  const mainPath = worktrees[0]?.path ?? repoRoot;

  // Current production branch.
  const prodResult = spawnSync('git', ['config', '--get', 'primordia.productionBranch'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const prodBranch = prodResult.stdout.trim() || null;

  const candidates: NonProdWorktree[] = [];
  for (const wt of worktrees) {
    if (!wt.branch) continue;
    if (wt.path === mainPath) continue;
    if (prodBranch && wt.branch === prodBranch) continue;
    try {
      const stat = fs.statSync(wt.path);
      candidates.push({ path: wt.path, branch: wt.branch, ctimeMs: stat.ctimeMs });
    } catch {
      // Worktree directory missing — still candidate for cleanup
      candidates.push({ path: wt.path, branch: wt.branch, ctimeMs: 0 });
    }
  }

  if (candidates.length === 0) return null;
  // Sort ascending by ctime (oldest first)
  candidates.sort((a, b) => a.ctimeMs - b.ctimeMs);
  return candidates[0];
}

/**
 * Get server health metrics
 * @description Returns disk usage, memory usage, and the oldest non-production worktree. Admin only.
 * @tag Admin
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: 'Admin required' }, { status: 403 });

  const repoRoot = process.cwd();
  const disk = getDiskInfo();
  const memory = getMemoryInfo();
  const oldestNonProdWorktree = getOldestNonProdWorktree(repoRoot);

  return Response.json({ disk, memory, oldestNonProdWorktree });
}

/**
 * Delete oldest non-production worktree
 * @description Removes the oldest non-production git worktree and its branch to free disk space. Admin only.
 * @tag Admin
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: 'Admin required' }, { status: 403 });

  const repoRoot = process.cwd();
  const target = getOldestNonProdWorktree(repoRoot);
  if (!target) {
    return Response.json({ error: 'No non-prod worktrees to delete.' }, { status: 404 });
  }

  // Kill any dev server running on the branch port (best-effort)
  try {
    const portResult = spawnSync(
      'git',
      ['config', '--get', `branch.${target.branch}.port`],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const port = portResult.stdout.trim();
    if (port) {
      spawnSync('bash', ['-c', `lsof -ti tcp:${port} | xargs -r kill -SIGTERM`], {
        encoding: 'utf8',
      });
    }
  } catch { /* best-effort */ }

  // Remove the worktree
  const removeResult = spawnSync(
    'git',
    ['worktree', 'remove', '--force', target.path],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (removeResult.status !== 0) {
    const stderr = removeResult.stderr?.trim() ?? '';
    // If the directory is already gone, git may still have the ref registered — try to prune
    spawnSync('git', ['worktree', 'prune'], { cwd: repoRoot });
    if (stderr && !stderr.includes("not a working tree")) {
      return Response.json({ error: `Failed to remove worktree: ${stderr}` }, { status: 500 });
    }
  }

  // Delete the branch
  spawnSync('git', ['branch', '-D', target.branch], { cwd: repoRoot, encoding: 'utf8' });

  // Remove branch port from git config (best-effort cleanup)
  spawnSync('git', ['config', '--unset', `branch.${target.branch}.port`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return Response.json({ deleted: { branch: target.branch, path: target.path } });
}
