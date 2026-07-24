// lib/branch-parent.ts
// Tracks branch parentage via empty "branch marker" commits so the relationship
// travels with the branch through clones (git config does not).

import { execFileSync, spawnSync } from 'node:child_process';

export const MARKER_SUBJECT = '[branch marker]';
export const BRANCHED_FROM_TRAILER = 'Branched-From';
export const BASE_COMMIT_TRAILER = 'Base-Commit';


function repoPath(override?: string): string {
  return override ?? process.cwd();
}

/**
 * Writes an empty commit to record which branch this branch was created from.
 * Call this immediately after `git worktree add -b <branch>`.
 */
export function writeBranchMarker(
  worktreePath: string,
  parentBranch: string,
  parentSha: string,
): void {
  const result = spawnSync(
    'git',
    [
      '-C', worktreePath,
      'commit', '--allow-empty',
      '-m', MARKER_SUBJECT,
      '--trailer', `${BRANCHED_FROM_TRAILER}: ${parentBranch}`,
      '--trailer', `${BASE_COMMIT_TRAILER}: ${parentSha}`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  if (result.error || result.status !== 0) {
    const details = [
      result.error?.message,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ].filter(Boolean).join('\n');
    throw new Error(
      `Failed to write branch marker commit in ${worktreePath} ` +
      `(parent ${parentBranch} at ${parentSha}):${details ? `\n${details}` : ''}`,
    );
  }
}

/**
 * Reads the branch marker from the branch's log.
 * Returns null if no marker is found or the branch does not exist.
 */
export function readBranchMarker(
  branchOrSha: string,
  repo?: string,
): { parentBranch: string; parentSha: string } | null {
  try {
    const out = execFileSync(
      'git',
      [
        '-C', repoPath(repo),
        'log', branchOrSha,
        '--first-parent',
        '--grep', `^${BRANCHED_FROM_TRAILER}:`,
        '--format=%B%x00',
        '-n', '1',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const body = out.split('\0')[0] ?? '';
    let parentBranch: string | null = null;
    let parentSha: string | null = null;
    for (const line of body.split('\n')) {
      const branchMatch = line.match(new RegExp(`^${BRANCHED_FROM_TRAILER}:\\s*(\\S+)\\s*$`, 'i'));
      if (branchMatch) {
        parentBranch = branchMatch[1];
        continue;
      }
      const shaMatch = line.match(new RegExp(`^${BASE_COMMIT_TRAILER}:\\s*([0-9a-f]{4,})\\s*$`, 'i'));
      if (shaMatch) {
        parentSha = shaMatch[1];
      }
    }
    return parentBranch && parentSha ? { parentBranch, parentSha } : null;
  } catch {
    return null;
  }
}

function readProductionBranch(root: string): string | null {
  try {
    return execFileSync('git', ['-C', root, 'config', '--get', 'primordia.productionBranch'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function branchExists(branch: string, root: string): boolean {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--verify', branch], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function isAncestor(ancestor: string, descendant: string, root: string): boolean {
  try {
    execFileSync(
      'git',
      ['-C', root, 'merge-base', '--is-ancestor', ancestor, descendant],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the effective parent branch for computing diffs and upstream syncs.
 * Reads branch-marker trailers only. If no marker exists, it returns null. If
 * the recorded parent has since been deployed, it returns current production.
 */
export function getParentBranch(
  branch: string,
  repo?: string,
): string | null {
  const root = repoPath(repo);
  const marker = readBranchMarker(branch, root);
  if (!marker) return null;

  const { parentBranch } = marker;
  const prodBranch = readProductionBranch(root);
  if (!branchExists(parentBranch, root)) return prodBranch;

  if (prodBranch && isAncestor(parentBranch, prodBranch, root)) {
    return prodBranch;
  }

  return parentBranch;
}

/**
 * Returns immutable branch-marker ancestry for the /threads tree.
 */
export function getBranchParent(
  branch: string,
  repo?: string,
): { parentBranch: string; parentSha: string } | null {
  return readBranchMarker(branch, repoPath(repo));
}
