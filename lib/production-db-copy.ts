import * as fs from 'fs';
import * as path from 'path';
import { runGit } from './git-runtime';

export interface CopyProductionDbResult {
  copied: boolean;
  sourcePath: string | null;
  destinationPath: string;
  error?: string;
  method?: 'direct-copy' | 'hot-swap';
}

function parseWorktreePathForBranch(porcelain: string, branchName: string): string | null {
  let currentPath: string | null = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim();
    } else if (line.startsWith('branch refs/heads/')) {
      const branch = line.slice('branch refs/heads/'.length).trim();
      if (branch === branchName && currentPath !== null) {
        return currentPath;
      }
    }
  }
  return null;
}

export async function vacuumSnapshotSqliteDb(sourcePath: string, snapshotPath: string): Promise<void> {
  try { fs.unlinkSync(snapshotPath); } catch { /* absent */ }
  try {
    const { Database } = await import('bun:sqlite');
    const srcDbHandle = new Database(sourcePath);
    try {
      srcDbHandle.prepare('VACUUM INTO ?').run(snapshotPath);
    } finally {
      srcDbHandle.close();
    }
  } catch (err) {
    try { fs.unlinkSync(snapshotPath); } catch { /* absent */ }
    throw err;
  }
}

export function replaceSqliteDbWithSnapshot(snapshotPath: string, destinationPath: string): void {
  // Remove WAL sidecars before swapping the main DB file so the destination
  // worktree opens a clean, self-contained snapshot from production.
  for (const sidecar of [destinationPath, `${destinationPath}-wal`, `${destinationPath}-shm`]) {
    try { fs.unlinkSync(sidecar); } catch { /* absent or in use: best effort */ }
  }
  fs.renameSync(snapshotPath, destinationPath);
}

async function vacuumCopySqliteDb(sourcePath: string, destinationPath: string): Promise<void> {
  const tempDestination = `${destinationPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await vacuumSnapshotSqliteDb(sourcePath, tempDestination);
    replaceSqliteDbWithSnapshot(tempDestination, destinationPath);
  } catch (err) {
    try { fs.unlinkSync(tempDestination); } catch { /* absent */ }
    throw err;
  }
}

export async function findProductionDbPath(repoRoot: string, dbName: string): Promise<string | null> {
  let productionBranch = '';
  try {
    productionBranch = runGit(['config', '--get', 'primordia.productionBranch'], repoRoot).trim();
  } catch { /* productionBranch not configured */ }

  if (productionBranch) {
    const worktreeList = runGit(['worktree', 'list', '--porcelain'], repoRoot);
    const productionWorktreePath = parseWorktreePathForBranch(worktreeList, productionBranch);
    if (productionWorktreePath) {
      const candidate = path.join(productionWorktreePath, dbName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // In local development, or before primordia.productionBranch has been set,
  // the server's current working directory is the best available prod source.
  const candidate = path.join(repoRoot, dbName);
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

/**
 * Copy the current production SQLite DB into a worktree using `VACUUM INTO`,
 * producing a consistent, WAL-free snapshot even while prod is actively writing.
 */
export async function copyProductionDbToWorktree(
  repoRoot: string,
  destinationWorktreePath: string,
): Promise<CopyProductionDbResult> {
  const dbName = '.primordia-auth.db';
  const destinationPath = path.join(destinationWorktreePath, dbName);
  const sourcePath = await findProductionDbPath(repoRoot, dbName);

  if (!sourcePath) {
    return { copied: false, sourcePath: null, destinationPath, error: 'production DB not found' };
  }

  try {
    if (fs.existsSync(destinationPath) && fs.realpathSync(sourcePath) === fs.realpathSync(destinationPath)) {
      return { copied: false, sourcePath, destinationPath, error: 'source and destination DB are the same file' };
    }
  } catch { /* realpath can fail if either path disappears; continue and let copy report the error */ }

  try {
    await vacuumCopySqliteDb(sourcePath, destinationPath);
    return { copied: true, sourcePath, destinationPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { copied: false, sourcePath, destinationPath, error: message };
  }
}
