// app/api/evolve/upstream-sync/route.ts
// Merge the parent branch into the session branch's worktree.
// POST
//   Body: { sessionId: string; action: "merge" }
//   Returns: { outcome: "merged" | "merged-with-conflict-resolution"; log: string }

import { runGit, resolveConflictsWithClaude } from '../../../../lib/evolve-sessions';
import { getSessionUser } from '../../../../lib/auth';
import { getSessionFromFilesystem } from '../../../../lib/session-events';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = (await request.json()) as { sessionId?: string; action?: string };
  if (!body.sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (body.action !== 'merge') {
    return Response.json({ error: 'action must be "merge"' }, { status: 400 });
  }

  const repoRoot = process.cwd();
  const session = getSessionFromFilesystem(body.sessionId, repoRoot);
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
    const result = await runGit(
      ['merge', parentBranch, '--no-ff', '-m', `chore: merge ${parentBranch} into ${branch}`],
      worktreePath,
    );
    if (result.code !== 0) {
      // Merge produced conflicts — attempt auto-resolution with Claude before giving up.
      // resolveConflictsWithClaude(root, mergedBranch, targetBranch) resolves in-place.
      const resolution = await resolveConflictsWithClaude(worktreePath, parentBranch, branch, repoRoot);
      if (!resolution.success) {
        await runGit(['merge', '--abort'], worktreePath);
        return Response.json(
          { error: `Merge failed and automatic conflict resolution also failed:\n${resolution.log}` },
          { status: 500 },
        );
      }
      return Response.json({
        outcome: 'merged-with-conflict-resolution',
        log: result.stdout + result.stderr + '\n\n' + resolution.log,
      });
    }
    return Response.json({ outcome: 'merged', log: result.stdout + result.stderr });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
