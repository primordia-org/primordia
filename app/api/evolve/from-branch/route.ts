// app/api/evolve/from-branch/route.ts
// Start an evolve session on an existing git branch (e.g. from an external contributor).
// The branch must already exist locally. The session ID is a generated slug distinct
// from the branch name (since branch names can contain slashes).
//
// POST { branchName: string }
// Returns: { sessionId: string }

import * as path from 'path';
import { getLlmClient } from '../../../../lib/llm-client';
import {
  startLocalEvolve,
  runGit,
  type LocalSession,
} from '../../../../lib/evolve-sessions';
import { getSessionUser, hasEvolvePermission } from '../../../../lib/auth';
import {
  getCandidateWorktreePath,
  appendSessionEvent,
  getSessionNdjsonPath,
} from '../../../../lib/session-events';

/** Ask Haiku to choose a short kebab-case slug from a branch name.
 *  Falls back to sanitising the branch name directly. */
async function slugFromBranchName(branchName: string): Promise<string> {
  try {
    const { client } = getLlmClient();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 32,
      messages: [
        {
          role: 'user',
          content:
            `Generate a short kebab-case slug (2–4 words, lowercase, hyphens only) that ` +
            `captures the essence of this git branch name. Reply with only the slug, nothing else.\n\n` +
            `Branch name: ${branchName}`,
        },
      ],
    });
    const block = response.content[0];
    if (block.type === 'text') {
      const cleaned = block.text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (cleaned.length > 0) return cleaned;
    }
  } catch {
    // Fall through to simple fallback
  }
  // Fallback: sanitise the branch name directly (replace slashes and non-slug chars)
  return branchName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Return a session ID that doesn't already exist as a branch or worktree. */
async function findUniqueSessionId(base: string, repoRoot: string): Promise<string> {
  const taken = async (id: string): Promise<boolean> => {
    const r = await runGit(['branch', '--list', id], repoRoot);
    if (r.stdout.trim().length > 0) return true;
    // Also check if the candidate worktree path already has a session ndjson file
    const { existsSync } = await import('fs');
    const candidatePath = getCandidateWorktreePath(id);
    return existsSync(path.join(candidatePath, '.primordia-session.ndjson'));
  };
  if (!(await taken(base))) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

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

  const repoRoot = process.cwd();

  // Validate that the branch exists locally
  const branchCheck = await runGit(['branch', '--list', branchName], repoRoot);
  if (!branchCheck.stdout.trim()) {
    return Response.json(
      { error: `Branch \`${branchName}\` does not exist locally.` },
      { status: 400 },
    );
  }

  // Generate a session ID slug from the branch name (branch names can contain
  // slashes which are not valid as directory names or session IDs).
  const slug = await slugFromBranchName(branchName);
  const sessionId = await findUniqueSessionId(slug, repoRoot);

  // Compute the worktree path using the session ID (not the branch name) so
  // that slashes in branch names don't create nested directories.
  const gitCommonDirResult = await runGit(['rev-parse', '--git-common-dir'], repoRoot);
  const gitCommonDir = path.resolve(repoRoot, gitCommonDirResult.stdout.trim());
  const mainRepoRoot = path.dirname(gitCommonDir);
  const worktreePath =
    path.basename(mainRepoRoot) === 'main'
      ? path.join(path.dirname(mainRepoRoot), sessionId)
      : path.join(mainRepoRoot, '..', 'primordia-worktrees', sessionId);

  // Check if a worktree for this branch is already registered (e.g. a previous session).
  // If so, reuse that path; otherwise create a new worktree checkout.
  const listResult = await runGit(['worktree', 'list', '--porcelain'], repoRoot);
  let actualWorktreePath = worktreePath;
  let worktreeAlreadyCreated = false;

  // Find existing worktree for this branch from porcelain output
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
