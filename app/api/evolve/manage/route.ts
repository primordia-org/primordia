// app/api/evolve/manage/route.ts
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

import { execSync, spawn } from 'child_process';
import {
  runGit,
  resolveConflictsWithClaude,
  runFollowupInWorktree,
  type LocalSession,
} from '../../../../lib/evolve-sessions';
import { getSessionUser } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';

/** Run an arbitrary command; resolves with stdout, stderr, and exit code. */
function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, code: 1 }));
  });
}

/**
 * Called server-side after a type-fix run completes.
 * Re-runs the TypeScript gate and either merges the branch (→ accepted) or
 * puts the session in an error state. Never loops — if type errors persist
 * after the fix, the session goes to error instead of triggering another fix.
 */
async function retryAcceptAfterFix(
  sessionId: string,
  repoRoot: string,
  parentBranch: string,
): Promise<void> {
  console.log(`[retryAcceptAfterFix] starting for session ${sessionId}, parentBranch=${parentBranch}`);
  const db = await getDb();
  const current = await db.getEvolveSession(sessionId);
  console.log(`[retryAcceptAfterFix] session status=${current?.status ?? 'not found'}`);
  // If the fix itself failed (status = error) or session is missing, do nothing.
  // The expected status at this point is 'fixing-types'; runFollowupInWorktree does NOT
  // transition to 'ready' when an onSuccess callback is provided.
  if (!current || current.status !== 'fixing-types') {
    console.log(`[retryAcceptAfterFix] aborting — expected 'fixing-types', got '${current?.status ?? 'not found'}'`);
    return;
  }

  const { branch, worktreePath, port } = current;

  /** Append text and persist session to error. */
  async function failWithError(msg: string): Promise<void> {
    const row = await db.getEvolveSession(sessionId);
    await db.updateEvolveSession(sessionId, {
      status: 'error',
      progressText: (row?.progressText ?? '') + msg,
      port: row?.port ?? null,
      previewUrl: row?.previewUrl ?? null,
    });
  }

  // Re-run the TypeScript check to verify the fix worked.
  console.log(`[retryAcceptAfterFix] re-running typecheck in ${worktreePath}`);
  const tscResult = await runCmd('bun', ['run', 'typecheck'], worktreePath);
  console.log(`[retryAcceptAfterFix] typecheck exit code=${tscResult.code}`);
  if (tscResult.code !== 0) {
    const typeErrors = (tscResult.stdout + tscResult.stderr).trim();
    console.log(`[retryAcceptAfterFix] typecheck still failing:\n${typeErrors}`);
    await failWithError(
      `\n\n❌ **Auto-fix failed**: TypeScript errors remain after the fix attempt.\n\n\`\`\`\n${typeErrors}\n\`\`\`\n`,
    );
    return;
  }

  // Type check passed — kill the preview dev server.
  console.log(`[retryAcceptAfterFix] typecheck passed, killing dev server on port ${port}`);
  if (port !== null) {
    try {
      const { execSync: execSyncLocal } = require('child_process') as typeof import('child_process');
      const pids = execSyncLocal(`lsof -ti tcp:${port}`, { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean).map(Number).filter(Boolean);
      console.log(`[retryAcceptAfterFix] killing pids ${pids.join(', ')}`);
      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      }
    } catch { /* no process on that port */ }
  }

  // Checkout the parent branch so the merge lands on the right branch.
  console.log(`[retryAcceptAfterFix] checking out parent branch ${parentBranch} in ${repoRoot}`);
  const checkoutResult = await runGit(['checkout', parentBranch], repoRoot);
  console.log(`[retryAcceptAfterFix] checkout exit code=${checkoutResult.code}${checkoutResult.code !== 0 ? ` stderr=${checkoutResult.stderr}` : ''}`);
  let mergeRoot = repoRoot;
  if (checkoutResult.code !== 0) {
    const alreadyCheckedOutMatch = checkoutResult.stderr.match(
      /(?:already checked out at|already used by worktree at) '([^']+)'/,
    );
    if (alreadyCheckedOutMatch) {
      mergeRoot = alreadyCheckedOutMatch[1];
      console.log(`[retryAcceptAfterFix] parent branch already checked out at ${mergeRoot}`);
    } else {
      await failWithError(
        `\n\n❌ **Accept failed**: \`git checkout ${parentBranch}\` failed:\n${checkoutResult.stderr}\n`,
      );
      return;
    }
  }

  // Stash any uncommitted changes so they don't block the merge.
  let stashed = false;
  const statusResult = await runGit(['status', '--porcelain'], mergeRoot);
  if (statusResult.stdout.trim()) {
    console.log(`[retryAcceptAfterFix] stashing uncommitted changes in ${mergeRoot}`);
    const stashResult = await runGit(
      ['stash', 'push', '-u', '-m', 'primordia-auto-stash-before-merge'],
      mergeRoot,
    );
    stashed = stashResult.code === 0 && !stashResult.stdout.includes('No local changes');
    console.log(`[retryAcceptAfterFix] stash result: stashed=${stashed}`);
  }

  // Merge the preview branch.
  console.log(`[retryAcceptAfterFix] merging branch ${branch} into ${parentBranch} at ${mergeRoot}`);
  const mergeResult = await runGit(
    ['merge', branch, '--no-ff', '-m', `chore: merge ${branch}`],
    mergeRoot,
  );
  console.log(`[retryAcceptAfterFix] merge exit code=${mergeResult.code}${mergeResult.code !== 0 ? ` stderr=${mergeResult.stderr}` : ''}`);

  if (mergeResult.code !== 0) {
    const resolution = await resolveConflictsWithClaude(mergeRoot, branch, parentBranch);
    console.log(`[retryAcceptAfterFix] conflict resolution success=${resolution.success}`);
    if (!resolution.success) {
      await runGit(['merge', '--abort'], mergeRoot);
      if (stashed) await runGit(['stash', 'pop'], mergeRoot);
      await failWithError(
        `\n\n❌ **Accept failed**: merge failed and automatic conflict resolution also failed.\n\n` +
        `Merge error:\n${mergeResult.stderr}\n\nAuto-resolution log:\n${resolution.log}\n`,
      );
      return;
    }
  }

  if (stashed) await runGit(['stash', 'pop'], mergeRoot);

  // Sync dependencies after merge so the running server reflects any
  // package.json changes that came in from the accepted branch.
  console.log(`[retryAcceptAfterFix] running bun install --frozen-lockfile in ${mergeRoot}`);
  const installResult = await runCmd('bun', ['install', '--frozen-lockfile'], mergeRoot);
  console.log(`[retryAcceptAfterFix] bun install exit code=${installResult.code}`);
  if (installResult.code !== 0) {
    await failWithError(
      `\n\n❌ **Accept failed**: \`bun install --frozen-lockfile\` failed after merge. ` +
      `The lockfile may be out of sync with package.json.\n\n` +
      `\`\`\`\n${(installResult.stdout + installResult.stderr).trim()}\n\`\`\`\n`,
    );
    return;
  }

  // Mark as accepted and log the decision.
  console.log(`[retryAcceptAfterFix] merge complete, marking session ${sessionId} as accepted`);
  const row = await db.getEvolveSession(sessionId);
  await db.updateEvolveSession(sessionId, {
    status: 'accepted',
    progressText: (row?.progressText ?? '') + `\n\n---\n\n✅ **Accepted** — merged into \`${parentBranch}\`\n`,
    port: row?.port ?? null,
    previewUrl: row?.previewUrl ?? null,
  });

  // Cleanup.
  await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot);
  await runGit(['branch', '-D', branch], repoRoot);
  await runGit(['config', '--remove-section', `branch.${branch}`], repoRoot);
}

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
      // ── Pre-accept gates ────────────────────────────────────────────────────

      // Gate 1: session branch must have all parent commits merged in.
      // `git merge-base --is-ancestor A B` exits 0 when A is an ancestor of B.
      const ancestorCheck = await runGit(
        ['merge-base', '--is-ancestor', parentBranch, 'HEAD'],
        worktreePath,
      );
      if (ancestorCheck.code !== 0) {
        return Response.json(
          {
            error:
              `Cannot accept: session branch "${branch}" is not up-to-date with "${parentBranch}". ` +
              `Please use the Merge (or Rebase) button on the session page to bring the session branch ` +
              `up-to-date before accepting.`,
          },
          { status: 400 },
        );
      }

      // Gate 2: worktree must have no uncommitted changes.
      const worktreeStatus = await runGit(['status', '--porcelain'], worktreePath);
      if (worktreeStatus.stdout.trim()) {
        return Response.json(
          {
            error:
              `Cannot accept: session worktree has uncommitted changes:\n\n` +
              `${worktreeStatus.stdout.trim()}\n\n` +
              `All changes must be committed before the session can be accepted.`,
          },
          { status: 400 },
        );
      }

      // Gate 3: TypeScript must compile without errors.
      const tscResult = await runCmd('bun', ['run', 'typecheck'], worktreePath);
      if (tscResult.code !== 0) {
        const typeErrors = (tscResult.stdout + tscResult.stderr).trim();
        // Automatically start a follow-up pass to fix the type errors.
        const fixPrompt =
          `The TypeScript type check failed. Fix all type errors so the code compiles ` +
          `without errors. Do not change any runtime behaviour — only fix the type issues.\n\n` +
          `TypeScript compiler output:\n\`\`\`\n${typeErrors}\n\`\`\``;
        const autoFixSession: LocalSession = {
          id: session.id,
          branch: session.branch,
          worktreePath: session.worktreePath,
          status: session.status as LocalSession['status'],
          devServerStatus: 'running',
          progressText: session.progressText,
          port: session.port,
          previewUrl: session.previewUrl,
          request: session.request,
          createdAt: session.createdAt,
        };
        console.log(`[manage/accept] type errors detected for session ${session.id}, starting auto-fix`);
        await db.updateEvolveSession(session.id, { status: 'fixing-types' });
        void runFollowupInWorktree(
          autoFixSession, fixPrompt, repoRoot, 'fixing-types',
          (fixedSession) => retryAcceptAfterFix(fixedSession.id, repoRoot, parentBranch),
          /* skipChangelog */ true,
        );
        return Response.json({ outcome: 'auto-fixing-types' });
      }

      // ── End pre-accept gates ────────────────────────────────────────────────

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

      // Sync dependencies after merge so the running server reflects any
      // package.json changes that came in from the accepted branch.
      const installResult = await runCmd('bun', ['install', '--frozen-lockfile'], mergeRoot);
      if (installResult.code !== 0) {
        return Response.json(
          {
            error:
              `Merge succeeded but \`bun install --frozen-lockfile\` failed. ` +
              `The lockfile may be out of sync with package.json.\n\n` +
              `${(installResult.stdout + installResult.stderr).trim()}`,
          },
          { status: 500 },
        );
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
