// app/api/evolve/upstream-sync/route.ts
// Merge or rebase the parent branch into the session branch's worktree.
// Only available in NODE_ENV=development.
//
// POST
//   Body: { sessionId: string; action: "merge" | "rebase" }
//   Returns: { outcome: "merged" | "rebased"; log: string }

import { runGit } from '../../../../lib/local-evolve-sessions';
import { getSessionUser } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (process.env.NODE_ENV !== 'development') {
    return Response.json(
      { error: 'Local evolve is only available in development mode' },
      { status: 403 },
    );
  }

  const body = (await request.json()) as { sessionId?: string; action?: string };
  if (!body.sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (body.action !== 'merge' && body.action !== 'rebase') {
    return Response.json({ error: 'action must be "merge" or "rebase"' }, { status: 400 });
  }

  const db = await getDb();
  const session = await db.getEvolveSession(body.sessionId);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const { worktreePath, branch } = session;

  // Read the parent branch from git config (written at worktree-creation time).
  const parentBranchResult = await runGit(
    ['config', `branch.${branch}.parent`],
    worktreePath,
  );
  const parentBranch = parentBranchResult.stdout.trim();
  if (!parentBranch) {
    return Response.json({ error: 'Could not determine parent branch' }, { status: 400 });
  }

  try {
    if (body.action === 'merge') {
      const result = await runGit(
        ['merge', parentBranch, '--no-ff', '-m', `chore: merge ${parentBranch} into ${branch}`],
        worktreePath,
      );
      if (result.code !== 0) {
        await runGit(['merge', '--abort'], worktreePath);
        return Response.json(
          { error: `Merge failed:\n${result.stderr}` },
          { status: 500 },
        );
      }
      return Response.json({ outcome: 'merged', log: result.stdout + result.stderr });
    }

    // action === 'rebase'
    const result = await runGit(['rebase', parentBranch], worktreePath);
    if (result.code !== 0) {
      await runGit(['rebase', '--abort'], worktreePath);
      return Response.json(
        { error: `Rebase failed:\n${result.stderr}` },
        { status: 500 },
      );
    }
    return Response.json({ outcome: 'rebased', log: result.stdout + result.stderr });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
