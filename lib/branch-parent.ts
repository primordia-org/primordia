// lib/branch-parent.ts
// Tracks branch parentage via empty "fork marker" commits so the relationship
// travels with the branch through clones (git config does not).

import { execFileSync } from 'node:child_process';

export const MARKER_SUBJECT = '[primordia] fork marker';
export const TRAILER_KEY = 'Primordia-Forked-From';

export const BRANCH_PARENT_SOURCES = ['git-config', 'fork-marker'] as const;
export type BranchParentSource = typeof BRANCH_PARENT_SOURCES[number];
export const DEFAULT_BRANCH_PARENT_SOURCE: BranchParentSource = 'git-config';

function repoPath(override?: string): string {
  return override ?? process.cwd();
}

/**
 * Writes an empty commit to record where this branch was forked from.
 * Call this immediately after `git worktree add -b <branch>`.
 */
export function writeForkMarker(
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
      '--trailer', `${TRAILER_KEY}: ${parentBranch}@${parentSha}`,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
}

/**
 * Reads the fork marker from the branch's log.
 * Returns null if no marker is found or the branch does not exist.
 */
export function readForkMarker(
  branchOrSha: string,
  repo?: string,
): { parentBranch: string; parentSha: string } | null {
  try {
    const out = execFileSync(
      'git',
      [
        '-C', repoPath(repo),
        'log', branchOrSha,
        '--grep', `^${TRAILER_KEY}:`,
        '--format=%B%x00',
        '-n', '1',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const body = out.split('\0')[0] ?? '';
    for (const line of body.split('\n')) {
      const match = line.match(new RegExp(`^${TRAILER_KEY}:\\s*(\\S+)@([0-9a-f]{4,})\\s*$`, 'i'));
      if (match) {
        return { parentBranch: match[1], parentSha: match[2] };
      }
    }
    return null;
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
 *
 * When source is `git-config`, this preserves the legacy behavior and reads
 * branch.<name>.parent from local git config only.
 *
 * When source is `fork-marker`, this reads the branch's fork-marker trailer.
 * If the recorded parent has since been deployed, it returns current production;
 * if no marker exists, it returns null so the new codepath can be tested without
 * silently falling back to legacy metadata.
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

  const marker = readForkMarker(branch, root);
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
 * Returns immutable fork ancestry according to the selected source.
 * Used by the /branches tree to show original parentage.
 */
export function getForkParent(
  branch: string,
  repo?: string,
  source: BranchParentSource = DEFAULT_BRANCH_PARENT_SOURCE,
): { parentBranch: string; parentSha: string } | null {
  const root = repoPath(repo);
  return source === 'git-config'
    ? readGitConfigParent(branch, root)
    : readForkMarker(branch, root);
}
