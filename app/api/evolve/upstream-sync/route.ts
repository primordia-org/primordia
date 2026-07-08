// app/api/evolve/upstream-sync/route.ts
// Merge the parent branch into the session branch's worktree.
// POST
//   Body: { sessionId: string; action: "merge" }
//   Returns: { outcome: "merged" | "merged-with-conflict-resolution"; log: string }

import { hotswapProductionDbIntoWorktree, runCommand, runGit, resolveConflictsWithAgent } from '@/lib/evolve-sessions';
import { getSessionUser } from '@/lib/auth';
import { getSessionFromFilesystem } from '@/lib/session-events';
import { getParentBranch } from '@/lib/branch-parent';
import { getBranchParentSource } from '@/lib/user-prefs';
import { withSocketStatusHint } from '@/lib/socket-status';

/** JSON body for POST /evolve/upstream-sync */
export interface EvolveUpstreamSyncBody {
  sessionId: string; // The thread id to sync upstream changes into.
  action: 'merge'; // The sync strategy. Currently only 'merge' is supported.
}

async function runBunInstallAfterMerge(worktreePath: string): Promise<string> {
  const installResult = await runCommand('bun', ['install'], worktreePath);
  const installLog = installResult.stdout + installResult.stderr;
  if (installResult.code !== 0) {
    throw new Error(withSocketStatusHint(`bun install failed after merge:\n${installLog || `exit code ${installResult.code}`}`, installLog));
  }
  return installLog;
}

/**
 * Merge parent branch into a thread
 * @description Merges the thread's parent branch into the thread workspace to pick up upstream changes. Auto-resolves conflicts via Claude if needed.
 * @tag Evolve
 * @body EvolveUpstreamSyncBody
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = (await request.json()) as { sessionId?: string; action?: string };
  if (!body.sessionId) {
    return Response.json({ error: 'thread id is required' }, { status: 400 });
  }
  if (body.action !== 'merge') {
    return Response.json({ error: 'action must be "merge"' }, { status: 400 });
  }

  const repoRoot = process.cwd();
  const session = getSessionFromFilesystem(body.sessionId, repoRoot);
  if (!session) {
    return Response.json({ error: 'Thread not found' }, { status: 404 });
  }

  const { worktreePath, branch } = session;
  const sessionContext = { id: session.id, userId: user.id };

  const parentSource = await getBranchParentSource(user.id);
  const parentBranch = getParentBranch(branch, undefined, parentSource);
  if (!parentBranch) {
    return Response.json({ error: 'Could not determine parent thread' }, { status: 400 });
  }

  try {
    const result = await runGit(
      ['merge', parentBranch, '--no-ff', '-m', `chore: merge ${parentBranch} into ${branch}`],
      worktreePath,
    );
    if (result.code !== 0) {
      // Merge produced conflicts — attempt auto-resolution with Claude before giving up.
      // resolveConflictsWithAgent(root, mergedBranch, targetBranch) resolves in-place.
      const resolution = await resolveConflictsWithAgent(worktreePath, parentBranch, branch, sessionContext, repoRoot);
      if (!resolution.success) {
        await runGit(['merge', '--abort'], worktreePath);
        return Response.json(
          { error: `Merge failed and automatic conflict resolution also failed:\n${resolution.log}` },
          { status: 500 },
        );
      }
      const installLog = await runBunInstallAfterMerge(worktreePath);
      const dbCopy = await hotswapProductionDbIntoWorktree(repoRoot, worktreePath, session.port);
      const dbCopyLog = dbCopy.copied
        ? '\nHot-swapped a production DB snapshot into this thread.'
        : dbCopy.error === 'production DB not found'
          ? '\nSkipped production DB hotswap: production DB not found.'
          : `\nSkipped production DB hotswap: ${dbCopy.error ?? 'unknown error'}.`;
      return Response.json({
        outcome: 'merged-with-conflict-resolution',
        log: result.stdout + result.stderr + '\n\n' + resolution.log + (installLog ? '\n' + installLog : '') + dbCopyLog,
      });
    }
    const installLog = await runBunInstallAfterMerge(worktreePath);
    const dbCopy = await hotswapProductionDbIntoWorktree(repoRoot, worktreePath, session.port);
    const dbCopyLog = dbCopy.copied
      ? '\nHot-swapped a production DB snapshot into this thread.'
      : dbCopy.error === 'production DB not found'
        ? '\nSkipped production DB hotswap: production DB not found.'
        : `\nSkipped production DB hotswap: ${dbCopy.error ?? 'unknown error'}.`;
    return Response.json({ outcome: 'merged', log: result.stdout + result.stderr + (installLog ? '\n' + installLog : '') + dbCopyLog });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
