// lib/branch-parent.ts
// Tracks branch parentage via empty "branch marker" commits so the relationship
// travels with the branch through clones (git config does not).

import { execFileSync } from 'node:child_process';

export const MARKER_SUBJECT = '[branch marker]';
export const BRANCHED_FROM_TRAILER = 'Branched-From';
export const BASE_COMMIT_TRAILER = 'Base-Commit';

export const BRANCH_PARENT_SOURCES = ['git-config', 'branch-marker'] as const;
export type BranchParentSource = typeof BRANCH_PARENT_SOURCES[number];
export const DEFAULT_BRANCH_PARENT_SOURCE: BranchParentSource = 'git-config';

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
  execFileSync(
    'git',
    [
      '-C', worktreePath,
      'commit', '--allow-empty',
      '-m', MARKER_SUBJECT,
      '--trailer', `${BRANCHED_FROM_TRAILER}: ${parentBranch}`,
      '--trailer', `${BASE_COMMIT_TRAILER}: ${parentSha}`,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
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

function readGitConfigParent(branch: string, root: string): { parentBranch: string; parentSha: string } | null {
  try {
    const parentBranch = execFileSync(
      'git',
      ['-C', root, 'config', '--get', `branch.${branch}.parent`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (!parentBranch) return null;
    try {
      const parentSha = execFileSync('git', ['-C', root, 'rev-parse', parentBranch], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return { parentBranch, parentSha };
    } catch {
      return { parentBranch, parentSha: '' };
    }
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

function revParse(branch: string, root: string): string {
  return execFileSync('git', ['-C', root, 'rev-parse', branch], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
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

function inferProductionParent(branch: string, root: string): { parentBranch: string; parentSha: string } | null {
  const productionBranch = readProductionBranch(root);
  if (!productionBranch || productionBranch === branch) return null;
  if (!branchExists(productionBranch, root)) return null;
  if (!isAncestor(productionBranch, branch, root)) return null;

  try {
    return { parentBranch: productionBranch, parentSha: revParse(productionBranch, root) };
  } catch {
    return { parentBranch: productionBranch, parentSha: '' };
  }
}

function readBranchMarkerWithFallback(branch: string, root: string): { parentBranch: string; parentSha: string } | null {
  return readBranchMarker(branch, root)
    ?? readGitConfigParent(branch, root)
    ?? inferProductionParent(branch, root);
}

/**
 * Returns the effective parent branch for computing diffs and upstream syncs.
 *
 * When source is `git-config`, this preserves the legacy behavior and reads
 * branch.<name>.parent from local git config only.
 *
 * When source is `branch-marker`, this reads the branch's marker trailers.
 * If no marker exists (for branches created before marker commits were added),
 * it falls back to legacy git-config metadata and then to production ancestry.
 * If the recorded parent has since been deployed, it returns current production.
 */
export function getParentBranch(
  branch: string,
  repo?: string,
  source: BranchParentSource = DEFAULT_BRANCH_PARENT_SOURCE,
): string | null {
  const root = repoPath(repo);

  if (source === 'git-config') {
    return readGitConfigParent(branch, root)?.parentBranch ?? null;
  }

  const marker = readBranchMarkerWithFallback(branch, root);
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
 * Returns immutable branch ancestry according to the selected source.
 * Used by the /branches tree to show original parentage.
 */
export function getBranchParent(
  branch: string,
  repo?: string,
  source: BranchParentSource = DEFAULT_BRANCH_PARENT_SOURCE,
): { parentBranch: string; parentSha: string } | null {
  const root = repoPath(repo);
  return source === 'git-config'
    ? readGitConfigParent(branch, root)
    : readBranchMarkerWithFallback(branch, root);
}
