// app/api/evolve/from-branch/route.ts
// Start an evolve session on an existing git branch (e.g. from an external contributor).
// The branch must already exist locally. The session ID is a generated slug distinct
// from the branch name (since branch names can contain slashes).
//
// POST { branchName: string; request?: string }
// Returns: { sessionId: string }

import * as path from 'path';
import { getLlmClient } from '../../../../lib/llm-client';
import {
  startLocalEvolve,
  runGit,
  type LocalSession,
} from '../../../../lib/evolve-sessions';
import { getSessionUser, hasEvolvePermission } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';
import { getPublicOrigin } from '../../../../lib/public-origin';

/** Ask Haiku to choose a short kebab-case slug from a branch name.
 *  Falls back to sanitising the branch name directly. */
async function slugFromBranchName(branchName: string): Promise<string> {
  try {
    const { client } = await getLlmClient();
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

/** Return a session ID that doesn't already exist in the DB or as a branch. */
async function findUniqueSessionId(base: string, repoRoot: string): Promise<string> {
  const db = await getDb();
  const taken = async (id: string): Promise<boolean> => {
    const existing = await db.getEvolveSession(id);
    if (existing) return true;
    const r = await runGit(['branch', '--list', id], repoRoot);
    return r.stdout.trim().length > 0;
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

  const body = (await request.json()) as { branchName?: string; request?: string };
  if (!body.branchName || typeof body.branchName !== 'string') {
    return Response.json({ error: 'branchName is required' }, { status: 400 });
  }

  const branchName = body.branchName.trim();
  const requestText = (body.request ?? '').trim() ||
    `Review and continue development on branch \`${branchName}\`.`;

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

  const session: LocalSession = {
    id: sessionId,
    branch: branchName,
    worktreePath,
    status: 'starting',
    devServerStatus: 'none',
    progressText: '',
    port: null,
    previewUrl: null,
    request: requestText,
    createdAt: Date.now(),
  };

  const db = await getDb();
  await db.createEvolveSession({
    id: session.id,
    branch: session.branch,
    worktreePath: session.worktreePath,
    status: session.status,
    progressText: session.progressText,
    port: session.port,
    previewUrl: session.previewUrl,
    request: session.request,
    createdAt: session.createdAt,
  });

  const publicOrigin = getPublicOrigin(request);

  void startLocalEvolve(session, requestText, repoRoot, publicOrigin, [], {
    skipBranchCreation: true,
  });

  return Response.json({ sessionId });
}
