// app/api/evolve/local/manage/route.ts
// Accept or reject a local evolve session — runs in the PARENT server only.
// Only available in NODE_ENV=development.
//
// POST
//   Body: { action: "accept" | "reject", sessionId: string }
//
//   accept — looks up the session in SQLite, kills the preview dev server
//            (found by its port via lsof), merges the preview branch into the
//            parent branch, removes the worktree and branch, and updates the
//            session status to "accepted".
//   reject — kills the preview dev server, removes the worktree and branch
//            without merging, updates the session status to "rejected".

import { execSync } from 'child_process';
import { runGit, resolveConflictsWithClaude } from '../../../../../lib/local-evolve-sessions';
import { getSessionUser } from '../../../../../lib/auth';
import { getDb } from '../../../../../lib/db';

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

  const body = (await request.json()) as { action?: string; sessionId?: string };
  if (body.action !== 'accept' && body.action !== 'reject') {
    return Response.json({ error: 'action must be "accept" or "reject"' }, { status: 400 });
  }
  if (!body.sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const db = await getDb();
  const session = await db.getEvolveSession(body.sessionId);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const repoRoot = process.cwd();
  const { branch, worktreePath } = session;

  // Read the parent branch from git config (stored when the worktree was created).
  const parentBranchResult = await runGit(['config', `branch.${branch}.parent`], repoRoot);
  const parentBranch = parentBranchResult.stdout.trim() || 'main';

  // Kill the preview dev server by finding its process via the port it is bound to.
  // `lsof -ti tcp:<port>` returns one PID per line; we SIGTERM each one.
  // If lsof finds nothing (exit code 1), the process is already gone — not an error.
  if (session.port !== null) {
    try {
      const pids = execSync(`lsof -ti tcp:${session.port}`, { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean).map(Number).filter(Boolean);
      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      }
    } catch {
      // lsof exited non-zero — no process bound to that port (already gone).
    }
  }

  /** Append a log entry and update the session status in the parent's own DB. */
  async function logDecision(action: 'accept' | 'reject'): Promise<void> {
    const row = await db.getEvolveSession(body.sessionId!);
    if (!row) return;
    const logEntry =
      action === 'accept'
        ? `\n\n---\n\n✅ **Accepted** — merged into \`${parentBranch}\`\n`
        : `\n\n---\n\n🗑️ **Rejected** — branch discarded\n`;
    await db.updateEvolveSession(body.sessionId!, {
      status: action === 'accept' ? 'accepted' : 'rejected',
      progressText: row.progressText + logEntry,
      port: row.port,
      previewUrl: row.previewUrl,
    });
  }

  try {
    if (body.action === 'accept') {
      // Checkout the parent branch so the merge lands on the right branch.
      const checkoutResult = await runGit(['checkout', parentBranch], repoRoot);
      let mergeRoot = repoRoot;
      if (checkoutResult.code !== 0) {
        const alreadyCheckedOutMatch = checkoutResult.stderr.match(
          /(?:already checked out at|already used by worktree at) '([^']+)'/,
        );
        if (alreadyCheckedOutMatch) {
          mergeRoot = alreadyCheckedOutMatch[1];
        } else {
          return Response.json(
            { error: `git checkout ${parentBranch} failed:\n${checkoutResult.stderr}` },
            { status: 500 },
          );
        }
      }

      // Stash any uncommitted local changes so they don't block the merge.
      let stashed = false;
      const statusResult = await runGit(['status', '--porcelain'], mergeRoot);
      if (statusResult.stdout.trim()) {
        const stashResult = await runGit(
          ['stash', 'push', '-u', '-m', 'primordia-auto-stash-before-merge'],
          mergeRoot,
        );
        stashed = stashResult.code === 0 && !stashResult.stdout.includes('No local changes');
      }

      // Merge the preview branch into the parent branch.
      const mergeResult = await runGit(
        ['merge', branch, '--no-ff', '-m', `chore: merge ${branch}`],
        mergeRoot,
      );

      if (mergeResult.code !== 0) {
        const resolution = await resolveConflictsWithClaude(mergeRoot, branch, parentBranch);
        if (!resolution.success) {
          await runGit(['merge', '--abort'], mergeRoot);
          if (stashed) await runGit(['stash', 'pop'], mergeRoot);
          return Response.json(
            {
              error:
                `git merge failed and automatic conflict resolution also failed.\n\n` +
                `Merge error:\n${mergeResult.stderr}\n\n` +
                `Auto-resolution log:\n${resolution.log}`,
            },
            { status: 500 },
          );
        }
      }

      // Restore stashed changes on top of the merge result.
      let stashWarning: string | undefined;
      if (stashed) {
        const popResult = await runGit(['stash', 'pop'], mergeRoot);
        if (popResult.code !== 0) {
          stashWarning =
            `Merge succeeded but restoring your stashed changes produced a conflict. ` +
            `Run \`git stash pop\` manually to resolve:\n${popResult.stderr}`;
        }
      }

      // Write the accepted status to the parent's own SQLite DB.
      await logDecision('accept');

      // Remove the worktree, delete the preview branch, clean up git config.
      await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot);
      await runGit(['branch', '-D', branch], repoRoot);
      // --remove-section exits with code 1 when the section is absent — ignore.
      await runGit(['config', '--remove-section', `branch.${branch}`], repoRoot);

      return Response.json({ outcome: 'accepted', branch, parentBranch, stashWarning });
    }

    // action === 'reject'
    await logDecision('reject');
    await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot);
    await runGit(['branch', '-D', branch], repoRoot);
    await runGit(['config', '--remove-section', `branch.${branch}`], repoRoot);

    return Response.json({ outcome: 'rejected' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
