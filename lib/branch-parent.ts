// lib/branch-parent.ts
// Tracks branch parentage via empty "fork marker" commits so the relationship
// travels with the branch through clones (git config does not).

import { execFileSync } from 'node:child_process';

export const MARKER_SUBJECT = '[primordia] fork marker';
export const TRAILER_KEY = 'Primordia-Forked-From';

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

/**
 * Returns the effective parent branch for computing diffs and upstream syncs.
 *
 * Resolution order:
 *  1. Marker's recorded parent, if that branch still exists AND is not yet
 *     merged into the current production branch (sibling/chain case).
 *  2. Current primordia.productionBranch (parent was accepted/deployed).
 *  3. Legacy git config branch.<name>.parent (pre-marker branches, from-branch sessions).
 */
export function getParentBranch(branch: string, repo?: string): string | null {
  const root = repoPath(repo);

  const marker = readForkMarker(branch, root);
  if (marker) {
    const { parentBranch } = marker;
    // Check whether the recorded parent branch still exists locally.
    const parentExists = (() => {
      try {
        execFileSync('git', ['-C', root, 'rev-parse', '--verify', parentBranch], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        return true;
      } catch {
        return false;
      }
    })();

    if (parentExists) {
      // Check if parentBranch is already merged into the current prod branch.
      const prodBranch = (() => {
        try {
          return execFileSync('git', ['-C', root, 'config', '--get', 'primordia.productionBranch'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim() || null;
        } catch {
          return null;
        }
      })();

      if (prodBranch) {
        // If parentBranch is an ancestor of prod it has been deployed; fall through to prod.
        const mergedIntoProd = (() => {
          try {
            execFileSync(
              'git',
              ['-C', root, 'merge-base', '--is-ancestor', parentBranch, prodBranch],
              { stdio: ['ignore', 'ignore', 'ignore'] },
            );
            return true;
          } catch {
            return false;
          }
        })();

        if (!mergedIntoProd) {
          return parentBranch;
        }
      } else {
        // No prod branch configured — treat parent as still active.
        return parentBranch;
      }
    }
  }

  // Fallback: current production branch.
  try {
    const prod = execFileSync(
      'git',
      ['-C', root, 'config', '--get', 'primordia.productionBranch'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (prod) return prod;
  } catch { /* no prod branch */ }

  // Legacy git config fallback for pre-marker branches.
  try {
    const legacy = execFileSync(
      'git',
      ['-C', root, 'config', '--get', `branch.${branch}.parent`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (legacy) return legacy;
  } catch { /* no config entry */ }

  return null;
}

/**
 * Returns the immutable fork ancestry recorded in the marker commit.
 * Used by the /branches tree to show original parentage regardless of deploy state.
 * Falls back to legacy git config (branch.<name>.parent) for pre-marker branches.
 */
export function getForkParent(
  branch: string,
  repo?: string,
): { parentBranch: string; parentSha: string } | null {
  const root = repoPath(repo);

  const marker = readForkMarker(branch, root);
  if (marker) return marker;

  // Legacy fallback: git config branch.<name>.parent (no sha available).
  try {
    const legacy = execFileSync(
      'git',
      ['-C', root, 'config', '--get', `branch.${branch}.parent`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (!legacy) return null;
    // Resolve current sha — may be null if branch is gone.
    try {
      const sha = execFileSync('git', ['-C', root, 'rev-parse', legacy], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return sha ? { parentBranch: legacy, parentSha: sha } : null;
    } catch {
      return { parentBranch: legacy, parentSha: '' };
    }
  } catch {
    return null;
  }
}
