// app/api/evolve/manage/route.ts
// Accept or reject a local evolve session — runs in the PARENT server only.
//
// POST
//   Body: { action: "accept" | "reject", sessionId: string }

//
//   accept — looks up the session, kills the preview dev server, then:
//
//            PRODUCTION (NODE_ENV === 'production'):
//              1. TypeScript gate — auto-fix via Claude if it fails
//              2. Run scripts/install.sh from the session worktree with REPORT_STYLE=ansi,
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


/** Exit code install.sh uses to signal a typecheck failure specifically. */
const INSTALL_EXIT_TYPECHECK = 2;

/**
 * Runs install.sh in the session worktree and resolves with the exit code.
 * Streams all stdout/stderr to the session log as it arrives.
 */
function runInstallSh(
  sessionId: string,
  worktreePath: string,
  branch: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const installScript = path.join(worktreePath, 'scripts', 'install.sh');
    const proc = spawn('bash', [installScript, branch], {
      cwd: worktreePath,
      env: { ...process.env, REPORT_STYLE: 'ansi' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const forward = (data: Buffer) => { void appendLogLine(sessionId, data.toString()); };
    proc.stdout.on('data', forward);
    proc.stderr.on('data', forward);
    proc.on('close', (code) => resolve(code ?? 1));
    proc.on('error', (err) => reject(new Error(`install.sh spawn failed: ${err.message}`)));
  });
}

/**
 * Called server-side after a type-fix run completes.
 * Re-runs install.sh (which re-runs the typecheck gate). If typecheck passes
 * the install continues through build → deploy. If it fails again the session
 * goes to error instead of looping.
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

  const { branch, worktreePath } = current;

  async function failWithError(msg: string): Promise<void> {
    await appendLogLine(sessionId, msg);
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) {
      appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'error', message: msg, ts: Date.now() });
    }
  }

  // Emit a fresh deploy section so post-fix logs appear under the deploy
  // heading rather than being buried in the type_fix section.
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

  // Kill the preview dev server before running install.sh.
  console.log(`[retryAcceptAfterFix] killing preview server for session ${sessionId}`);
  try {
    await fetch(`http://127.0.0.1:${process.env.REVERSE_PROXY_PORT!}/_proxy/preview/${sessionId}`, {
      method: 'DELETE',
    });
  } catch { /* proxy not running — preview server may already be gone */ }

  if (isProduction) {
    const exitCode = await runInstallSh(sessionId, worktreePath, branch).catch((err) => {
      void failWithError(`❌ Auto-fix failed (install.sh spawn error): ${err instanceof Error ? err.message : String(err)}`);
      return -1;
    });
    if (exitCode === -1) return;

    if (exitCode === INSTALL_EXIT_TYPECHECK) {
      const errorsFile = path.join(worktreePath, '.primordia-typecheck-errors.txt');
      const typeErrors = fs.existsSync(errorsFile) ? fs.readFileSync(errorsFile, 'utf8').trim() : '(no output captured)';
      console.log(`[retryAcceptAfterFix] typecheck still failing after fix attempt:\n${typeErrors}`);
      await failWithError(
        `❌ Auto-fix failed: TypeScript errors remain after the fix attempt.\n\`\`\`\n${typeErrors}\n\`\`\``,
      );
      return;
    }

    if (exitCode !== 0) {
      await failWithError(`❌ Auto-fix failed: install.sh exited with code ${exitCode}.`);
      return;
    }

    // install.sh completed successfully — it has already deployed.
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) {
      appendSessionEvent(ndjsonPath, { type: 'decision', action: 'accepted', detail: 'deployed to production', ts: Date.now() });
    }
    setTimeout(() => process.exit(0), 1000);

  } else {
    // Legacy local-dev path: just record success (the merge already happened
    // before the type-fix loop; we don't re-merge here).
    await failWithError('❌ Auto-fix retry is only supported in production mode.');
  }
}

/**
 * Runs the accept steps asynchronously so the POST handler can return
 * immediately and the client can stream progress via the existing SSE endpoint.
 *
 * Production path:
 *   1. Run install.sh from the session worktree with REPORT_STYLE=ansi,
 *      streaming its output as log_line events. install.sh handles typecheck
 *      (exit 2 on failure), build, DB copy, sibling reparenting, proxy spawn,
 *      main advancement, and mirror push.
 *   2. On exit code 2: read .primordia-typecheck-errors.txt and trigger the
 *      auto-fix Claude session (fixing-types → retryAcceptAfterFix).
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

    if (isProduction) {
      // ── Production: run install.sh from the session worktree ─────────────
      // install.sh handles: typecheck (exits 2 on failure), bun install, build,
      // DB copy, sibling reparenting, proxy spawn, main pointer advancement,
      // and mirror push.
      const exitCode = await runInstallSh(sessionId, worktreePath, branch);

      if (exitCode === INSTALL_EXIT_TYPECHECK) {
        // ── TypeScript gate failed: trigger the auto-fix Claude session ───────
        const errorsFile = path.join(worktreePath, '.primordia-typecheck-errors.txt');
        const typeErrors = fs.existsSync(errorsFile)
          ? fs.readFileSync(errorsFile, 'utf8').trim()
          : '(no output captured)';
        const fixPrompt =
          `The TypeScript type check failed. Fix all type errors so the code compiles ` +
          `without errors. Do not change any runtime behaviour — only fix the type issues.\n\n` +
          `TypeScript compiler output:\n\`\`\`\n${typeErrors}\n\`\`\``;
        const sessionSnap = getSessionFromFilesystem(sessionId, repoRoot);
        if (!sessionSnap) return;
        const autoFixSession: LocalSession = {
          id: sessionSnap.id,
          branch: sessionSnap.branch,
          worktreePath: sessionSnap.worktreePath,
          status: sessionSnap.status as LocalSession['status'],
          devServerStatus: 'running',
          port: sessionSnap.port,
          previewUrl: sessionSnap.previewUrl,
          request: sessionSnap.request,
          createdAt: sessionSnap.createdAt,
          userId,
        };
        console.log(`[runAcceptAsync] typecheck failed for session ${sessionId}, starting auto-fix`);
        void runFollowupInWorktree(
          autoFixSession, fixPrompt, repoRoot, 'fixing-types',
          (fixedSession) => retryAcceptAfterFix(fixedSession.id, repoRoot, parentBranch),
          /* internalSectionType */ 'type_fix',
        );
        return;
      }

      if (exitCode !== 0) {
        throw new Error(`install.sh exited with code ${exitCode}`);
      }

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

/** JSON body for POST /evolve/manage */
export interface EvolveManageBody {
  action: 'accept' | 'reject'; // Whether to accept (deploy) or reject (discard) the session.
  sessionId: string; // The session ID (git branch name) to accept or reject.
}

/**
 * Accept or reject an evolve session
 * @description POST to accept (deploy) or reject (discard) a ready evolve session. Requires `can_evolve` or `admin` role.
 * @tag Evolve
 * @body EvolveManageBody
 */
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
            stuckSessionId: concurrentDeploy.id,
            stuckSessionBranch: concurrentDeploy.branch,
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
