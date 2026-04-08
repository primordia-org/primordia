#!/usr/bin/env bun
// scripts/rollback.ts
// Standalone fast rollback: updates PROD to the previous slot (PROD@{1}) and
// restarts the proxy service (which will start the rolled-back server).
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

// Get current production branch from PROD symbolic-ref.
const prodResult = spawnSync('git', ['symbolic-ref', '--short', 'PROD'], {
  cwd: repoRoot, encoding: 'utf8',
});
if (prodResult.status !== 0 || !prodResult.stdout.trim()) {
  console.error('Error: PROD symbolic-ref is not set.');
  process.exit(1);
}
const prodBranch = prodResult.stdout.trim();

// Get previous production commit from PROD@{1}.
const prevCommitResult = spawnSync('git', ['rev-parse', 'PROD@{1}'], {
  cwd: repoRoot, encoding: 'utf8',
});
if (prevCommitResult.status !== 0 || !prevCommitResult.stdout.trim()) {
  console.error('Error: no previous slot in PROD reflog (PROD@{1} does not exist).');
  process.exit(1);
}
const prevCommit = prevCommitResult.stdout.trim();

// List all registered worktrees.
const wtResult = spawnSync('git', ['worktree', 'list', '--porcelain'], {
  cwd: repoRoot, encoding: 'utf8',
});
const worktrees = parseWorktreeList(wtResult.stdout);

// Current slot = worktree on the PROD branch.
const currentWorktree = worktrees.find(wt => wt.branch === prodBranch);
if (!currentWorktree) {
  console.error(`Error: no worktree found for current production branch '${prodBranch}'.`);
  process.exit(1);
}
const currentTarget = currentWorktree.path;

// Previous slot = worktree whose HEAD commit matches PROD@{1}.
const previousWorktree = worktrees.find(wt => wt.head === prevCommit && wt.path !== currentTarget);
if (!previousWorktree?.branch) {
  console.error(`Error: no worktree found for previous production commit ${prevCommit.slice(0, 8)}.`);
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

// Update PROD symbolic-ref to point to the previous branch.
console.log(`Updating PROD → ${previousBranch}...`);
spawnSync('git', ['symbolic-ref', 'PROD', `refs/heads/${previousBranch}`], { cwd: repoRoot });
console.log('  Done.');
console.log('');

// Restart the proxy service. The proxy will read the updated PROD ref and
// start the production server on the previous slot's pre-assigned port.
console.log('Restarting proxy service...');
try {
  execSync('sudo systemctl restart primordia-proxy', { stdio: 'inherit' });
  console.log('  Service restarted.');
} catch (err) {
  console.error(`  Failed to restart service: ${err}`);
  console.error('  Run manually: sudo systemctl restart primordia-proxy');
  process.exit(1);
}

console.log('');
console.log('Rollback complete.');
