// app/api/branches/route.ts
// Returns all local git branches as a tree structure with parent relationships
// and active preview server URLs from in-memory local evolve sessions.
// Only available in development mode.

import { execSync } from 'child_process';
import { sessions } from '@/lib/local-evolve-sessions';

export interface BranchData {
  name: string;
  /** True if this branch is currently checked out in the main repo. */
  isCurrent: boolean;
  /** Value of git config branch.<name>.parent — set by the local evolve flow. */
  parent: string | null;
  /** Preview server URL if a session is active, null otherwise. */
  previewUrl: string | null;
  /** Session status, or null if no session is active for this branch. */
  sessionStatus: string | null;
}

export interface BranchesResponse {
  branches: BranchData[];
  /** URL of the main dev server (the server handling this request). */
  mainServerUrl: string;
}

function gitSync(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json(
      { error: 'Branches page is only available in development mode' },
      { status: 403 },
    );
  }

  // List all local branches, one per line
  const branchOutput = gitSync('git branch --format=%(refname:short)');
  const allBranches = branchOutput ? branchOutput.split('\n').filter(Boolean) : [];

  // Current checked-out branch in this repo
  const currentBranch = gitSync('git branch --show-current') || 'main';

  const branches: BranchData[] = allBranches.map((name) => {
    // Parent stored by the local evolve flow: git config branch.<name>.parent
    const parent = gitSync(`git config branch.${name}.parent`) || null;

    // Sessions are keyed by sessionId = branch name with 'evolve/' prefix stripped.
    // e.g. branch "evolve/add-dark-mode" → sessionId "add-dark-mode"
    const sessionId = name.replace(/^evolve\//, '');
    const session = sessions.get(sessionId);

    return {
      name,
      isCurrent: name === currentBranch,
      parent,
      previewUrl: session?.previewUrl ?? null,
      sessionStatus: session?.status ?? null,
    };
  });

  // Sort: main first, then evolve/* alphabetically, then any other branches
  branches.sort((a, b) => {
    if (a.name === 'main') return -1;
    if (b.name === 'main') return 1;
    const aEvolve = a.name.startsWith('evolve/');
    const bEvolve = b.name.startsWith('evolve/');
    if (aEvolve && !bEvolve) return -1;
    if (!aEvolve && bEvolve) return 1;
    return a.name.localeCompare(b.name);
  });

  // Derive the main server URL from the incoming request's Host header
  const host = request.headers.get('host') || 'localhost:3000';
  const protocol = host.startsWith('localhost') || host.match(/^[\d.]+:/) ? 'http' : 'https';
  const mainServerUrl = `${protocol}://${host}`;

  return Response.json({ branches, mainServerUrl } satisfies BranchesResponse);
}
