import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface GitWorktreeInfo {
  path: string;
  branch: string | null;
}

export interface PrimordiaRuntimePaths {
  root: string;
  worktreesDir: string;
  mainRepo: string;
}

export function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function getGitRepoRoot(cwd: string): string {
  const commonDir = runGit(['rev-parse', '--git-common-dir'], cwd).trim();
  return path.resolve(cwd, commonDir);
}

/**
 * Computes installed Primordia paths relative to the invoked reverse-proxy
 * entrypoint. Supported entrypoints:
 *   - {PRIMORDIA_ROOT}/reverse-proxy.js
 *   - {PRIMORDIA_ROOT}/scripts/reverse-proxy.ts
 */
export function getPrimordiaRuntimePaths(entrypoint = process.argv[1]): PrimordiaRuntimePaths {
  if (!entrypoint) {
    throw new Error('Cannot determine Primordia root: process.argv[1] is empty');
  }

  const entrypointPath = path.resolve(entrypoint);
  const root = path.basename(path.dirname(entrypointPath)) === 'scripts'
    ? path.dirname(path.dirname(entrypointPath))
    : path.dirname(entrypointPath);

  const mainRepo = path.join(root, 'source.git');
  const worktreesDir = path.join(root, 'worktrees');
  if (!fs.existsSync(mainRepo) || !fs.existsSync(worktreesDir)) {
    throw new Error(
      `Cannot determine Primordia root from entrypoint ${entrypointPath}: expected ${mainRepo} and ${worktreesDir}`,
    );
  }

  return { root, mainRepo, worktreesDir };
}

export function listGitWorktrees(repoRoot: string): GitWorktreeInfo[] {
  return parseWorktrees(runGit(['worktree', 'list', '--porcelain'], repoRoot));
}

function parseWorktrees(porcelain: string): GitWorktreeInfo[] {
  const worktrees: GitWorktreeInfo[] = [];
  let current: GitWorktreeInfo | null = null;
  let currentIsBare = false;

  const flush = () => {
    if (current && !currentIsBare) worktrees.push(current);
    current = null;
    currentIsBare = false;
  };

  for (const line of porcelain.split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      current = { path: line.slice('worktree '.length), branch: null };
    } else if (current && line.startsWith('branch ')) {
      const ref = line.slice('branch '.length);
      current.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    } else if (current && line === 'detached') {
      current.branch = null;
    } else if (current && line === 'bare') {
      currentIsBare = true;
    }
  }
  flush();
  return worktrees;
}

export function readBranchPorts(repoRoot: string): Map<string, number> {
  const ports = new Map<string, number>();
  let out = '';
  try {
    out = runGit(['config', '--get-regexp', '^branch\\.[^.]+\\.port$'], repoRoot);
  } catch {
    return ports;
  }

  for (const line of out.trim().split('\n')) {
    if (!line) continue;
    const firstSpace = line.indexOf(' ');
    if (firstSpace === -1) continue;
    const key = line.slice(0, firstSpace);
    const value = line.slice(firstSpace + 1).trim();
    const match = key.match(/^branch\.([^.]+)\.port$/);
    const port = Number.parseInt(value, 10);
    if (match && Number.isFinite(port)) ports.set(match[1], port);
  }
  return ports;
}

export function readProductionBranch(repoRoot: string): string | null {
  try {
    const value = runGit(['config', '--get', 'primordia.productionBranch'], repoRoot).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function readGitConfigValue(repoRoot: string, key: string): string | null {
  try {
    const value = runGit(['config', '--get', key], repoRoot).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function writeGitConfigValue(repoRoot: string, key: string, value: string): void {
  runGit(['config', key, value], repoRoot);
}

export function addGitConfigValue(repoRoot: string, key: string, value: string): void {
  runGit(['config', '--add', key, value], repoRoot);
}

export function unsetGitConfigValue(repoRoot: string, key: string): void {
  runGit(['config', '--unset', key], repoRoot);
}

export function removeGitWorktree(repoRoot: string, worktreePath: string): void {
  runGit(['worktree', 'remove', '--force', worktreePath], repoRoot);
}

export function pruneGitWorktrees(repoRoot: string): void {
  runGit(['worktree', 'prune'], repoRoot);
}

export function deleteGitBranch(repoRoot: string, branch: string): void {
  runGit(['branch', '-D', branch], repoRoot);
}

export function readCurrentBranch(repoRoot: string): string | null {
  try {
    const value = runGit(['symbolic-ref', '--short', 'HEAD'], repoRoot).trim();
    return value || null;
  } catch {
    return null;
  }
}
