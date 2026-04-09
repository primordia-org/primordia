#!/usr/bin/env bun
// scripts/rollback.ts
// Standalone fast rollback: updates primordia.productionBranch to the previous
// slot and restarts the proxy service (which will start the rolled-back server).
// Equivalent to POST /api/rollback but runs directly via bun — use this when
// the server itself is broken or unresponsive.
//
// Usage: bun run rollback
//   (no authentication — run via SSH / direct terminal access only)

import { execSync, spawnSync } from 'child_process';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

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

const repoRoot = path.resolve(import.meta.dir, '..');

// Get current production branch from git config.
const prodResult = spawnSync('git', ['config', '--get', 'primordia.productionBranch'], {
  cwd: repoRoot, encoding: 'utf8',
});
if (prodResult.status !== 0 || !prodResult.stdout.trim()) {
  console.error('Error: primordia.productionBranch is not set in git config.');
  process.exit(1);
}
const prodBranch = prodResult.stdout.trim();

// Get production history (oldest-first from git config --get-all; reverse for newest-first).
const historyResult = spawnSync('git', ['config', '--get-all', 'primordia.productionHistory'], {
  cwd: repoRoot, encoding: 'utf8',
});
const historyBranches = (historyResult.stdout || '').trim().split('\n').filter(Boolean).reverse();
if (historyBranches.length < 2) {
  console.error('Error: no previous slot in production history (primordia.productionHistory has fewer than 2 entries).');
  process.exit(1);
}
const previousBranchFromHistory = historyBranches[1];

// List all registered worktrees.
const wtResult = spawnSync('git', ['worktree', 'list', '--porcelain'], {
  cwd: repoRoot, encoding: 'utf8',
});
const worktrees = parseWorktreeList(wtResult.stdout);

// Current slot = worktree on the production branch.
const currentWorktree = worktrees.find(wt => wt.branch === prodBranch);
if (!currentWorktree) {
  console.error(`Error: no worktree found for current production branch '${prodBranch}'.`);
  process.exit(1);
}
const currentTarget = currentWorktree.path;

// Previous slot = worktree on the previously-current production branch.
const previousWorktree = worktrees.find(wt => wt.branch === previousBranchFromHistory && wt.path !== currentTarget);
if (!previousWorktree?.branch) {
  console.error(`Error: no worktree found for previous production branch '${previousBranchFromHistory}'.`);
  console.error('  The previous slot may have been pruned.');
  process.exit(1);
}
const previousTarget = previousWorktree.path;
const previousBranch = previousWorktree.branch;

console.log('Rolling back:');
console.log(`  current  → ${currentTarget} (${prodBranch})`);
console.log(`  previous → ${previousTarget} (${previousBranch})`);
console.log('');

// Copy the live DB into the previous slot so auth data is preserved.
console.log('Copying database from current slot to previous slot...');
try {
  copyDb(currentTarget, previousTarget);
  console.log('  Done.');
} catch (err) {
  console.warn(`  Warning: DB copy failed (proceeding anyway): ${err}`);
}

// Update git config to point to the previous branch.
console.log(`Updating production branch → ${previousBranch}...`);
spawnSync('git', ['config', 'primordia.productionBranch', previousBranch], { cwd: repoRoot });
spawnSync('git', ['config', '--add', 'primordia.productionHistory', previousBranch], { cwd: repoRoot });
console.log('  Done.');
console.log('');

// Restart the proxy service so it picks up the updated git config.
// On non-Linux platforms (e.g. macOS) systemd is unavailable — just print a reminder.
const hasSystemctl = spawnSync('which', ['systemctl'], { encoding: 'utf8' }).status === 0;
if (!hasSystemctl) {
  console.log('systemctl not available — skipping proxy service restart.');
  console.log('Restart the proxy manually: bun ~/primordia-proxy.ts');
} else {
  console.log('Restarting proxy service...');
  try {
    execSync('sudo systemctl restart primordia-proxy', { stdio: 'inherit' });
    console.log('  Service restarted.');
  } catch (err) {
    console.error(`  Failed to restart service: ${err}`);
    console.error('  Run manually: sudo systemctl restart primordia-proxy');
    process.exit(1);
  }
}

console.log('');
console.log('Rollback complete.');
