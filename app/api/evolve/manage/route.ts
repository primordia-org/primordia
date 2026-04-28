// app/api/evolve/manage/route.ts
// Accept or reject a local evolve session — runs in the PARENT server only.
//
// POST
//   Body: { action: "accept" | "reject", sessionId: string }

/**
 * Accept or reject an evolve session
 * @description POST `{ action: "accept" | "reject", sessionId }` to accept (deploy) or reject (discard) a ready evolve session. Requires `can_evolve` or `admin` role.
 * @tags Evolve
 * @openapi
 */
//
//   accept — looks up the session, kills the preview dev server, then:
//
//            PRODUCTION (NODE_ENV === 'production'):
//              1. TypeScript gate — auto-fix via Claude if it fails
//              2. Run scripts/install.sh from the session worktree with REPORT_STYLE=plain,
//                 streaming its output as log_line events. install.sh handles build, DB copy,
//                 sibling reparenting, proxy spawn, main pointer advancement, and mirror push.
//              3. Write decision event + self-terminate (proxy already switched traffic)
//
//            LEGACY (local dev, NODE_ENV !== 'production'):
//              git checkout → stash → merge → stash-pop → bun install → worktree remove
//
//   reject — kills the preview dev server, removes the worktree and branch
//            without merging, updates the session status to "rejected".

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  runGit,
  runFollowupInWorktree,
  resolveConflictsWithAgent,
  type LocalSession,
} from '../../../../lib/evolve-sessions';
import { getSessionUser } from '../../../../lib/auth';
import {
  appendSessionEvent,
  getSessionNdjsonPath,
  getSessionFromFilesystem,
  listSessionsFromFilesystem,
} from '../../../../lib/session-events';

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

/** Write a log line event to the session's NDJSON file. */
function appendLogLine(sessionId: string, content: string): Promise<void> {
  const repoRoot = process.cwd();
  const row = getSessionFromFilesystem(sessionId, repoRoot);
  if (!row) return Promise.resolve();
  const ndjsonPath = getSessionNdjsonPath(row.worktreePath);
  if (fs.existsSync(ndjsonPath)) {
    appendSessionEvent(ndjsonPath, { type: 'log_line', content, ts: Date.now() });
  }
  return Promise.resolve();
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
  const current = getSessionFromFilesystem(sessionId, repoRoot);
  if (!current) {
    console.log(`[retryAcceptAfterFix] aborting — session not found`);
    return;
  }

  const { branch, worktreePath, port } = current;

  /** Append an error result event (makes inferred status 'ready') and log the message. */
  async function failWithError(msg: string): Promise<void> {
    await appendLogLine(sessionId, msg);
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) {
      appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'error', message: msg, ts: Date.now() });
    }
  }

  // Emit a fresh deploy section so post-fix logs appear under the deploy
  // heading in the UI rather than being buried in the type_fix section.
  const isProduction = process.env.NODE_ENV === 'production';
  {
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) {
      appendSessionEvent(ndjsonPath, {
        type: 'section_start',
        sectionType: 'deploy',
        label: isProduction ? '🚀 Deploying to production' : `🚀 Merging into \`${parentBranch}\``,
        ts: Date.now(),
      });
    }
  }

  // Re-run the TypeScript check to verify the fix worked.
  await appendLogLine(sessionId, '- Re-checking TypeScript types…');
  console.log(`[retryAcceptAfterFix] re-running typecheck in ${worktreePath}`);
  const tscResult = await runCmd('bun', ['run', 'typecheck'], worktreePath);
  console.log(`[retryAcceptAfterFix] typecheck exit code=${tscResult.code}`);
  if (tscResult.code !== 0) {
    const typeErrors = (tscResult.stdout + tscResult.stderr).trim();
    console.log(`[retryAcceptAfterFix] typecheck still failing:\n${typeErrors}`);
    await failWithError(
      `❌ Auto-fix failed: TypeScript errors remain after the fix attempt.\n\`\`\`\n${typeErrors}\n\`\`\``,
    );
    return;
  }

  // Also verify the production build succeeds.
  await appendLogLine(sessionId, '- Re-building for production…');
  console.log(`[retryAcceptAfterFix] re-running build in ${worktreePath}`);
  const buildResult = await runCmd('bun', ['run', 'build'], worktreePath);
  console.log(`[retryAcceptAfterFix] build exit code=${buildResult.code}`);
  if (buildResult.code !== 0) {
    const buildErrors = (buildResult.stdout + buildResult.stderr).trim();
    console.log(`[retryAcceptAfterFix] build still failing:\n${buildErrors}`);
    await failWithError(
      `❌ Auto-fix failed: Production build still failing after the fix attempt.\n\`\`\`\n${buildErrors}\n\`\`\``,
    );
    return;
  }

  // Typecheck passed — ask the proxy to kill the preview dev server.
  console.log(`[retryAcceptAfterFix] typecheck passed, killing preview server for session ${sessionId}`);
  try {
    await fetch(`http://127.0.0.1:${process.env.REVERSE_PROXY_PORT!}/_proxy/preview/${sessionId}`, {
      method: 'DELETE',
    });
  } catch { /* proxy not running — preview server may already be gone */ }

  if (isProduction) {
    // Run install.sh from the session worktree — same as the normal accept path.
    const installScript = path.join(worktreePath, 'scripts', 'install.sh');
    await appendLogLine(sessionId, '- Running install.sh…\n');
    console.log(`[retryAcceptAfterFix] running install.sh for session ${sessionId}`);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('bash', [installScript, branch], {
        cwd: worktreePath,
        env: { ...process.env, REPORT_STYLE: 'plain' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const forward = (data: Buffer) => { void appendLogLine(sessionId, data.toString()); };
      proc.stdout.on('data', forward);
      proc.stderr.on('data', forward);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`install.sh exited with code ${code}`));
      });
      proc.on('error', (err) => reject(new Error(`install.sh spawn failed: ${err.message}`)));
    });

    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) {
      appendSessionEvent(ndjsonPath, { type: 'decision', action: 'accepted', detail: 'deployed to production', ts: Date.now() });
    }
    setTimeout(() => process.exit(0), 1000);

  } else {
    // Legacy path (local dev without systemd).
    console.log(`[retryAcceptAfterFix] checking out parent branch ${parentBranch} in ${repoRoot}`);
    const checkoutResult = await runGit(['checkout', parentBranch], repoRoot);
    let mergeRoot = repoRoot;
    if (checkoutResult.code !== 0) {
      const alreadyCheckedOutMatch = checkoutResult.stderr.match(
        /(?:already checked out at|already used by worktree at) '([^']+)'/,
      );
      if (alreadyCheckedOutMatch) {
        mergeRoot = alreadyCheckedOutMatch[1];
      } else {
        await failWithError(
          `\n\n❌ **Accept failed**: \`git checkout ${parentBranch}\` failed:\n${checkoutResult.stderr}\n`,
        );
        return;
      }
    }

    let stashed = false;
    const statusResult = await runGit(['status', '--porcelain'], mergeRoot);
    if (statusResult.stdout.trim()) {
      const stashResult = await runGit(
        ['stash', 'push', '-u', '-m', 'primordia-auto-stash-before-merge'],
        mergeRoot,
      );
      stashed = stashResult.code === 0 && !stashResult.stdout.includes('No local changes');
    }

    await appendLogLine(sessionId, '- Merging branch…');
    const mergeResult = await runGit(
      ['merge', branch, '--no-ff', '-m', `chore: merge ${branch}`],
      mergeRoot,
    );

    if (mergeResult.code !== 0) {
      await runGit(['merge', '--abort'], mergeRoot);
      if (stashed) await runGit(['stash', 'pop'], mergeRoot);
      await failWithError(
        `❌ Accept failed: merge conflict in ${mergeRoot}.\n` +
        `Use Apply Updates on the session page to resolve conflicts before accepting.\n\n` +
        `Merge error:\n${mergeResult.stderr}`,
      );
      return;
    }

    if (stashed) await runGit(['stash', 'pop'], mergeRoot);

    await appendLogLine(sessionId, '- Installing dependencies…');
    const installResult = await runCmd('bun', ['install', '--frozen-lockfile'], mergeRoot);
    if (installResult.code !== 0) {
      await failWithError(
        `❌ Accept failed: \`bun install --frozen-lockfile\` failed after merge.\n` +
        `\`\`\`\n${(installResult.stdout + installResult.stderr).trim()}\n\`\`\``,
      );
      return;
    }

    await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot);
    await runGit(['branch', '-D', branch], repoRoot);
    await runGit(['config', '--remove-section', `branch.${branch}`], repoRoot);

    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) {
      appendSessionEvent(ndjsonPath, { type: 'decision', action: 'accepted', detail: `merged into \`${parentBranch}\``, ts: Date.now() });
    }
  }
}

/**
 * Runs the accept steps asynchronously so the POST handler can return
 * immediately and the client can stream progress via the existing SSE endpoint.
 *
 * Production path:
 *   1. TypeScript gate — auto-fix via Claude if it fails.
 *   2. Run install.sh from the session worktree with REPORT_STYLE=plain,
 *      streaming its output as log_line events. install.sh handles the build,
 *      DB copy, sibling reparenting, proxy spawn, main advancement, and mirror push.
 *   3. Write the decision event and self-terminate (the proxy has already
 *      switched traffic to the new slot).
 *
 * Legacy path (local dev, NODE_ENV !== 'production'):
 *   git merge → bun install (unchanged from before).
 */
async function runAcceptAsync(
  sessionId: string,
  worktreePath: string,
  branch: string,
  parentBranch: string,
  repoRoot: string,
  userId: string,
): Promise<void> {
  const step = (text: string) => appendLogLine(sessionId, text);

  async function failWithError(msg: string): Promise<void> {
    await appendLogLine(sessionId, msg);
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) {
      appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'error', message: msg, ts: Date.now() });
    }
  }

  try {
    const isProduction = process.env.NODE_ENV === 'production';

    // ── TypeScript gate (production only) ────────────────────────────────────
    if (isProduction) {
      await step('- Type-checking…');
      const tscResult = await runCmd('bun', ['run', 'typecheck'], worktreePath);
      if (tscResult.code !== 0) {
        const typeErrors = (tscResult.stdout + tscResult.stderr).trim();
        const fixPrompt =
          `The TypeScript type check failed. Fix all type errors so the code compiles ` +
          `without errors. Do not change any runtime behaviour — only fix the type issues.\n\n` +
          `TypeScript compiler output:\n\`\`\`\n${typeErrors}\n\`\`\``;
        const session = getSessionFromFilesystem(sessionId, repoRoot);
        if (!session) return;
        const autoFixSession: LocalSession = {
          id: session.id,
          branch: session.branch,
          worktreePath: session.worktreePath,
          status: session.status as LocalSession['status'],
          devServerStatus: 'running',
          port: session.port,
          previewUrl: session.previewUrl,
          request: session.request,
          createdAt: session.createdAt,
          userId,
        };
        console.log(`[runAcceptAsync] type errors for session ${sessionId}, starting auto-fix`);
        void runFollowupInWorktree(
          autoFixSession, fixPrompt, repoRoot, 'fixing-types',
          (fixedSession) => retryAcceptAfterFix(fixedSession.id, repoRoot, parentBranch),
          /* internalSectionType */ 'type_fix',
        );
        return;
      }
    }

    if (isProduction) {
      // ── Production: run install.sh from the session worktree ─────────────
      // install.sh handles: bun install, build, DB copy, sibling reparenting,
      // proxy spawn (zero-downtime), main pointer advancement, mirror push.
      const installScript = path.join(worktreePath, 'scripts', 'install.sh');
      await step('- Running install.sh…\n');

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('bash', [installScript, branch], {
          cwd: worktreePath,
          env: { ...process.env, REPORT_STYLE: 'plain' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const forward = (data: Buffer) => {
          void appendLogLine(sessionId, data.toString());
        };
        proc.stdout.on('data', forward);
        proc.stderr.on('data', forward);

        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`install.sh exited with code ${code}`));
        });
        proc.on('error', (err) => reject(new Error(`install.sh spawn failed: ${err.message}`)));
      });

      // Mark as accepted.
      const ndjsonPath = getSessionNdjsonPath(worktreePath);
      if (fs.existsSync(ndjsonPath)) {
        appendSessionEvent(ndjsonPath, { type: 'decision', action: 'accepted', detail: 'deployed to production', ts: Date.now() });
      }

      // Self-terminate: the proxy has already switched traffic to the new slot.
      setTimeout(() => process.exit(0), 1000);

    } else {
      // ── Legacy path (local dev without systemd) ───────────────────────────
      const checkoutResult = await runGit(['checkout', parentBranch], repoRoot);
      let mergeRoot = repoRoot;
      if (checkoutResult.code !== 0) {
        const alreadyCheckedOutMatch = checkoutResult.stderr.match(
          /(?:already checked out at|already used by worktree at) '([^']+)'/,
        );
        if (alreadyCheckedOutMatch) {
          mergeRoot = alreadyCheckedOutMatch[1];
        } else {
          await failWithError(
            `❌ Accept failed: \`git checkout ${parentBranch}\` failed:\n${checkoutResult.stderr}`,
          );
          return;
        }
      }

      let stashed = false;
      const statusResult = await runGit(['status', '--porcelain'], mergeRoot);
      if (statusResult.stdout.trim()) {
        const stashResult = await runGit(
          ['stash', 'push', '-u', '-m', 'primordia-auto-stash-before-merge'],
          mergeRoot,
        );
        stashed = stashResult.code === 0 && !stashResult.stdout.includes('No local changes');
      }

      await step('- Merging branch…');
      const mergeResult = await runGit(
        ['merge', branch, '--no-ff', '-m', `chore: merge ${branch}`],
        mergeRoot,
      );

      if (mergeResult.code !== 0) {
        await runGit(['merge', '--abort'], mergeRoot);
        if (stashed) await runGit(['stash', 'pop'], mergeRoot);
        await failWithError(
          `❌ Accept failed: merge conflict in ${mergeRoot}.\n` +
          `This should not happen when the branch is up-to-date. ` +
          `Use Apply Updates on the session page to resolve conflicts before accepting.\n\n` +
          `Merge error:\n${mergeResult.stderr}`,
        );
        return;
      }

      if (stashed) {
        const popResult = await runGit(['stash', 'pop'], mergeRoot);
        if (popResult.code !== 0) {
          await step(`⚠️ Merge succeeded but restoring stashed changes produced a conflict. Run \`git stash pop\` manually to resolve.`);
        }
      }

      await step('- Installing dependencies…');
      const installResult = await runCmd('bun', ['install', '--frozen-lockfile'], mergeRoot);
      if (installResult.code !== 0) {
        await failWithError(
          `❌ Accept failed: \`bun install --frozen-lockfile\` failed after merge.\n` +
          `\`\`\`\n${(installResult.stdout + installResult.stderr).trim()}\n\`\`\``,
        );
        return;
      }

      const ndjsonPath = getSessionNdjsonPath(worktreePath);
      if (fs.existsSync(ndjsonPath)) {
        appendSessionEvent(ndjsonPath, { type: 'decision', action: 'accepted', detail: `merged into \`${parentBranch}\``, ts: Date.now() });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runAcceptAsync] unexpected error for session ${sessionId}:`, err);
    await failWithError(`❌ Accept failed (unexpected error): ${msg}`).catch(() => {});
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = (await request.json()) as { action?: string; sessionId?: string };
  if (body.action !== 'accept' && body.action !== 'reject') {
    return Response.json({ error: 'action must be "accept" or "reject"' }, { status: 400 });
  }
  if (!body.sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const repoRoot = process.cwd();
  const session = getSessionFromFilesystem(body.sessionId, repoRoot);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const { branch, worktreePath } = session;

  // Read the parent branch from git config (stored when the worktree was created).
  const parentBranchResult = await runGit(['config', `branch.${branch}.parent`], repoRoot);
  const parentBranch = parentBranchResult.stdout.trim() || 'main';

  const isProduction = process.env.NODE_ENV === 'production';

  // Ask the reverse proxy to stop the preview dev server for this session.
  // For dev accepts we keep the worktree alive (logs + preview server remain
  // accessible), so there's no need to kill the preview server up front.
  const shouldKillPreview = body.action === 'reject' || isProduction;
  if (shouldKillPreview) {
    try {
      await fetch(`http://127.0.0.1:${process.env.REVERSE_PROXY_PORT!}/_proxy/preview/${body.sessionId}`, {
        method: 'DELETE',
      });
    } catch { /* proxy not running — preview server may already be gone */ }
  }

  /** Write a decision event (makes inferred status 'accepted' or 'rejected'). */
  async function logDecision(action: 'accept' | 'reject'): Promise<void> {
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) {
      const detail = action === 'accept'
        ? (isProduction ? 'deployed to production' : `merged into \`${parentBranch}\``)
        : 'changes discarded';
      appendSessionEvent(ndjsonPath, { type: 'decision', action: action === 'accept' ? 'accepted' : 'rejected', detail, ts: Date.now() });
    }
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
        // Automatically apply updates (merge parent into session branch) before accepting.
        const sessionContext = { id: body.sessionId, userId: user.id };
        const mergeResult = await runGit(
          ['merge', parentBranch, '--no-ff', '-m', `chore: merge ${parentBranch} into ${branch}`],
          worktreePath,
        );
        if (mergeResult.code !== 0) {
          const resolution = await resolveConflictsWithAgent(worktreePath, parentBranch, branch, sessionContext, repoRoot);
          if (!resolution.success) {
            await runGit(['merge', '--abort'], worktreePath);
            return Response.json(
              { error: `Cannot accept: session branch is not up-to-date with "${parentBranch}" and automatic merge failed:\n${resolution.log}` },
              { status: 400 },
            );
          }
        }
      }

      // Gate 2: worktree must have no uncommitted changes.
      // If there are uncommitted changes, automatically start a follow-up agent
      // session with "commit changes" as the prompt instead of showing an error.
      const worktreeStatus = await runGit(['status', '--porcelain'], worktreePath);
      if (worktreeStatus.stdout.trim()) {
        const uncommittedFiles = worktreeStatus.stdout.trim();
        const commitPrompt =
          `The session has uncommitted changes that must be committed before the branch can be accepted into production. ` +
          `Please commit all uncommitted changes with a clear, descriptive git commit message. ` +
          `Do not modify any files — only stage and commit the existing changes.\n\n` +
          `Uncommitted changes:\n\`\`\`\n${uncommittedFiles}\n\`\`\`\n\n` +
          `Do NOT create or update the changelog file for this commit.`;
        const commitSession: LocalSession = {
          id: session.id,
          branch: session.branch,
          worktreePath: session.worktreePath,
          status: 'ready',
          devServerStatus: 'running',
          port: session.port,
          previewUrl: session.previewUrl,
          request: session.request,
          createdAt: session.createdAt,
          userId: user.id,
        };
        // runFollowupInWorktree will emit the 'auto_commit' section_start itself.
        void runFollowupInWorktree(commitSession, commitPrompt, repoRoot, 'running-claude', /* onSuccess */ undefined, /* internalSectionType */ 'auto_commit');
        return Response.json({ outcome: 'auto-committing' });
      }

      // ── Gate 3: no concurrent deploy ──────────────────────────────────────
      // Reject if another session is already mid-deploy. Two concurrent accepts
      // would race in install.sh; the second one could overwrite the first
      // deploy's production slot before it's healthy.
      const allSessions = listSessionsFromFilesystem(repoRoot);
      const concurrentDeploy = allSessions.find(
        (s) => s.status === 'accepting' && s.id !== body.sessionId,
      );
      if (concurrentDeploy) {
        return Response.json(
          {
            error:
              `A deploy is already in progress (session "${concurrentDeploy.branch}"). ` +
              `Please wait for it to finish, then try again.`,
          },
          { status: 409 },
        );
      }

      // ── Kick off async accept ──────────────────────────────────────────────
      // Gates 1+2+3 pass. The remaining work (type-check, build, merge) runs
      // fire-and-forget so the client receives a response immediately and can
      // stream progress via SSE.
      {
        const ndjsonPath = getSessionNdjsonPath(worktreePath);
        if (fs.existsSync(ndjsonPath)) {
          // section_start:deploy makes inferred status 'accepting' while deploy runs
          appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: 'deploy', label: isProduction ? '🚀 Deploying to production' : `🚀 Merging into \`${parentBranch}\``, ts: Date.now() });
        }
      }
      void runAcceptAsync(body.sessionId, worktreePath, branch, parentBranch, repoRoot, user.id);
      return Response.json({ outcome: 'accepting' });
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
