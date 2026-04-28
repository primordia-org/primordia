// app/api/evolve/from-branch/route.ts
// Start an evolve session on an existing git branch (e.g. from an external contributor).
// The branch must already exist locally and must not contain a slash.
//
// POST { branchName: string }
// Returns: { sessionId: string }

import * as path from 'path';
import {
  startLocalEvolve,
  runGit,
  getRepoRoot,
  getWorktreesDir,
  type LocalSession,
} from '../../../../lib/evolve-sessions';
import { getSessionUser, hasEvolvePermission } from '../../../../lib/auth';
import {
  appendSessionEvent,
  getSessionNdjsonPath,
  getCandidateWorktreePath,
} from '../../../../lib/session-events';

/** JSON body for POST /evolve/from-branch */
export interface EvolveFromBranchBody {
  branchName: string; // Name of the existing local git branch to attach a session to. Must not contain a slash.
}

/**
 * Start an evolve session on an existing branch
 * @description Attaches the full AI preview pipeline to an existing local git branch (e.g. from an external contributor). Requires `can_evolve` or `admin` role.
 * @tags Evolve
 * @body EvolveFromBranchBody
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (!(await hasEvolvePermission(user.id))) {
    return Response.json({ error: 'You do not have permission to use the evolve flow' }, { status: 403 });
  }

  const body = (await request.json()) as { branchName?: string };
  if (!body.branchName || typeof body.branchName !== 'string') {
    return Response.json({ error: 'branchName is required' }, { status: 400 });
  }

  const branchName = body.branchName.trim();

  // Branches with slashes are not supported — they can't be used as URL path
  // segments or directory names without ambiguity.
  if (branchName.includes('/')) {
    return Response.json(
      { error: `Branch \`${branchName}\` contains a slash and is not supported. Only simple branch names are supported.` },
      { status: 400 },
    );
  }

  const repoRoot = process.cwd();

  // Validate that the branch exists locally.
  const branchCheck = await runGit(['branch', '--list', branchName], repoRoot);
  if (!branchCheck.stdout.trim()) {
    return Response.json(
      { error: `Branch \`${branchName}\` does not exist locally.` },
      { status: 400 },
    );
  }

  // The session ID is the branch name directly.
  const sessionId = branchName;

  // Compute the worktree path.
  const repoGitRoot = getRepoRoot(repoRoot);
  const worktreePath = path.join(getWorktreesDir(repoGitRoot), sessionId);

  // Check if a worktree for this branch is already registered (e.g. a previous session).
  // If so, reuse that path; otherwise create a new worktree checkout.
  const listResult = await runGit(['worktree', 'list', '--porcelain'], repoRoot);
  let actualWorktreePath = worktreePath;
  let worktreeAlreadyCreated = false;

  let curPath: string | null = null;
  for (const line of listResult.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      curPath = line.slice('worktree '.length).trim();
    } else if (line.startsWith('branch refs/heads/') && curPath) {
      if (line.slice('branch refs/heads/'.length).trim() === branchName) {
        actualWorktreePath = curPath;
        worktreeAlreadyCreated = true;
        break;
      }
    }
  }

  if (!worktreeAlreadyCreated) {
    // Also check if a session already exists at the candidate path
    const { existsSync } = await import('fs');
    const candidatePath = getCandidateWorktreePath(sessionId);
    if (existsSync(path.join(candidatePath, '.primordia-session.ndjson'))) {
      actualWorktreePath = candidatePath;
      worktreeAlreadyCreated = true;
    }
  }

  if (!worktreeAlreadyCreated) {
    const wtResult = await runGit(['worktree', 'add', actualWorktreePath, branchName], repoRoot);
    if (wtResult.code !== 0) {
      return Response.json({ error: `Failed to create session worktree: ${wtResult.stderr}` }, { status: 500 });
    }
  }

  // Write the initial_request event synchronously so getSessionFromFilesystem()
  // can find the session immediately (the ndjson file is the session existence marker).
  // No request text — this session starts as an instant preview with no initial agent run.
  const ndjsonPath = getSessionNdjsonPath(actualWorktreePath);
  appendSessionEvent(ndjsonPath, { type: 'initial_request', request: '', ts: Date.now() });

  const session: LocalSession = {
    id: sessionId,
    branch: branchName,
    worktreePath: actualWorktreePath,
    status: 'starting',
    devServerStatus: 'none',
    port: null,
    previewUrl: null,
    request: '',
    createdAt: Date.now(),
    userId: user.id,
  };

  void startLocalEvolve(session, '', repoRoot, undefined, [], {
    worktreeAlreadyCreated: true,
    initialEventAlreadyWritten: true,
  });

  return Response.json({ sessionId });
}
