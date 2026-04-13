// app/api/evolve/manage/route.ts
// Accept or reject a local evolve session — runs in the PARENT server only.
//
// POST
//   Body: { action: "accept" | "reject", sessionId: string }
//
//   accept — looks up the session in SQLite, kills the preview dev server
//            (via the reverse proxy management API), then performs one of two merge paths:
//
//            BLUE/GREEN (production, when NODE_ENV === 'production'):
//              1. bun install --frozen-lockfile in the session worktree
//              2. No merge commit — Gate 1 guarantees session branch already contains parentBranch;
//                 parentBranch is NOT advanced (old slot stays at its original commit for rollback).
//                 Sibling sessions whose git config parent = parentBranch are reparented to session
//                 branch so "Apply Updates" picks up the new production code going forward.
//              3. Copy production DB into new slot (VACUUM INTO — atomic snapshot); fix .env.local symlink
//              4. Persist "accepted" status + final progress log to DB
//              5. Final VACUUM INTO new slot DB (captures complete accepted state)
//              6. POST /_proxy/prod/spawn → proxy spawns new prod server, health-checks, sets
//                 primordia.productionBranch in git config, and switches traffic (does NOT kill old server)
//              7. Run scripts/update-service.sh — daemon-reload if service unit changed;
//                 restart primordia-proxy if reverse-proxy.ts changed (non-fatal on error).
//                 Must run AFTER step 6: if the proxy script changed, restarting before spawn
//                 would kill the proxy before it handles the spawn request.
//              8. Old prod server self-terminates (process.exit) after update-service.sh completes.
//              9. Old slot kept indefinitely as registered git worktree (enables deep rollback via /admin/rollback)
//
//            LEGACY (local dev, NODE_ENV !== 'production'):
//              git checkout → stash → merge → stash-pop → bun install → worktree remove
//
//   reject — kills the preview dev server, removes the worktree and branch
//            without merging, updates the session status to "rejected".

import { execSync, execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Database } from 'bun:sqlite';
import {
  runGit,
  resolveConflictsWithClaude,
  runFollowupInWorktree,
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
 * Reparents sibling evolve sessions in git config.
 *
 * When a session branch is accepted as the new production, any other in-flight
 * sessions whose `branch.{X}.parent` was the old parentBranch should now treat
 * the accepted session branch as their parent.  This ensures "Apply Updates"
 * correctly offers the new production changes to those sessions going forward.
 *
 * The parentBranch ref itself is NOT advanced — leaving it at its pre-accept
 * commit is what makes the production history rollback work correctly.
 */
function reparentSiblings(
  repoRoot: string,
  parentBranch: string,
  newParentBranch: string,
): void {
  try {
    const configList = execFileSync('git', ['config', '--list'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const line of configList.split('\n')) {
      const match = line.match(/^branch\.(.+)\.parent=(.+)$/);
      if (match && match[2] === parentBranch) {
        const siblingBranch = match[1];
        if (siblingBranch !== newParentBranch) {
          try {
            execFileSync('git', ['config', `branch.${siblingBranch}.parent`, newParentBranch], {
              cwd: repoRoot,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe'],
            });
          } catch { /* best-effort */ }
        }
      }
    }
  } catch { /* best-effort */ }
}

const DB_NAME = '.primordia-auth.db';

/**
 * Creates a consistent point-in-time snapshot of the SQLite DB using
 * VACUUM INTO — safe while the source DB is being actively written to.
 */
function copyDb(srcDir: string, dstDir: string): void {
  const srcDb = path.join(srcDir, DB_NAME);
  if (!fs.existsSync(srcDb)) return;
  const dstDb = path.join(dstDir, DB_NAME);
  // VACUUM INTO fails if the destination file already exists
  fs.rmSync(dstDb, { force: true });
  fs.rmSync(dstDb + '-wal', { force: true });
  fs.rmSync(dstDb + '-shm', { force: true });
  const db = new Database(srcDb);
  try {
    db.prepare('VACUUM INTO ?').run(dstDb);
  } finally {
    db.close();
  }
}

type BlueGreenAcceptResult =
  | { ok: false; error: string }
  | { ok: true; branch: string };

/**
 * Blue/green accept path.
 *
 * Builds and activates the session worktree as the new production slot without
 * running any git or bun commands in the live production directory.
 *
 * Returns { ok: false, error } on failure, or { ok: true, branch } on success.
 */
async function blueGreenAccept(
  worktreePath: string,
  branch: string,
  parentBranch: string,
  repoRoot: string,
  onStep: (text: string) => Promise<void> = async () => {},
): Promise<BlueGreenAcceptResult> {
  // Compute the main repo root (shared .git dir's parent) — needed for
  // install-service.sh path and as the fallback old-slot on first accept.
  const gitCommonResult = await runGit(['rev-parse', '--git-common-dir'], worktreePath);
  const mainRepoRoot = gitCommonResult.code === 0
    ? path.dirname(path.resolve(worktreePath, gitCommonResult.stdout.trim()))
    : path.resolve(repoRoot); // fallback: assume repoRoot is the main repo

  // Find the current production slot via primordia.productionBranch in git config.
  // Falls back to the main repo on the very first accept (before git config is set).
  let oldSlot: string = mainRepoRoot;
  try {
    const prodBranch = execFileSync('git', ['config', '--get', 'primordia.productionBranch'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (prodBranch) {
      const wtOut = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let curPath: string | undefined;
      let curBranch: string | null = null;
      for (const line of wtOut.split('\n')) {
        if (line.startsWith('worktree ')) { curPath = line.slice(9); curBranch = null; }
        else if (line.startsWith('branch ')) { curBranch = line.slice(7).replace('refs/heads/', ''); }
        else if (line === '' && curPath && curBranch === prodBranch) { oldSlot = curPath; break; }
      }
      // Handle last entry (no trailing blank line)
      if (oldSlot === mainRepoRoot && curPath && curBranch === prodBranch) oldSlot = curPath;
    }
  } catch {
    // primordia.productionBranch not yet set — fall through to mainRepoRoot default
  }

  // Step 1: ensure node_modules are up to date in the session worktree.
  // This is the only bun install that runs, and it runs in the worktree (not production).
  await onStep('- Installing dependencies…\n');
  const installResult = await runCmd('bun', ['install', '--frozen-lockfile'], worktreePath);
  if (installResult.code !== 0) {
    return { ok: false, error:
      `bun install --frozen-lockfile failed in session worktree:\n` +
      (installResult.stdout + installResult.stderr).trim()
    };
  }

  // Step 2: no merge commit — Gate 1 (ancestor check) guarantees the session
  // branch already contains all commits from parentBranch, so it is the correct
  // tree for production.  parentBranch is intentionally NOT advanced here:
  // keeping the old slot's branch at its pre-accept commit is what lets the PROD
  // reflog hash-matching rollback find it later.  Instead, reparent any sibling
  // sessions that branched off parentBranch so their "Apply Updates" action will
  // pull in the new production code going forward.
  reparentSiblings(repoRoot, parentBranch, branch);

  // Copy the production database into the new slot via VACUUM INTO — an atomic,
  // consistent snapshot safe to take while the live server writes.
  try {
    copyDb(oldSlot, path.resolve(worktreePath));
  } catch {
    // Non-fatal: the worktree's existing DB snapshot from session creation is still usable.
  }

  // Fix the .env.local symlink in the new slot so it always points directly to
  // the main repo's copy — which is never deleted. Without this, the symlink
  // would point to the old slot's .env.local, which gets cleaned up on the next
  // accept, leaving a dangling link.
  const mainEnvPath = path.join(mainRepoRoot, '.env.local');
  const worktreeEnvPath = path.join(path.resolve(worktreePath), '.env.local');
  if (fs.existsSync(mainEnvPath)) {
    fs.rmSync(worktreeEnvPath, { force: true });
    fs.symlinkSync(mainEnvPath, worktreeEnvPath);
  }

  // Spawning the new prod server, health-checking it, and switching traffic are
  // handled by the proxy (POST /_proxy/prod/spawn) after the final DB writes.
  return { ok: true, branch };
}

/** Build an authenticated https remote URL from GITHUB_TOKEN + GITHUB_REPO.
 *  Returns null if either env var is missing. */
function buildAuthRemoteUrl(): string | null {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return null;
  // username = token, password = blank (empty string after the colon)
  return `https://${token}:@github.com/${repo}.git`;
}

/**
 * Moves the `main` branch pointer to the HEAD of the accepted session branch
 * and pushes it to the remote. `main` is a stable reference that external
 * users can clone to always get the latest production code.
 *
 * Non-fatal: errors are logged as warnings so a push failure never blocks a deploy.
 */
async function moveMainAndPush(
  worktreePath: string,
  branch: string,
  onStep: (text: string) => Promise<void>,
): Promise<void> {
  // Resolve the main repo root from the shared .git dir so we run git
  // commands against the repo rather than just the worktree checkout.
  const gitCommonResult = await runGit(['rev-parse', '--git-common-dir'], worktreePath);
  const mainRepoRoot = gitCommonResult.code === 0
    ? path.dirname(path.resolve(worktreePath, gitCommonResult.stdout.trim()))
    : worktreePath;

  await onStep('- Advancing main branch pointer…\n');

  // Force-move the `main` branch ref to the accepted session branch HEAD.
  const moveResult = await runGit(['branch', '-f', 'main', branch], mainRepoRoot);
  if (moveResult.code !== 0) {
    await onStep(`  ⚠ Could not move main branch: ${moveResult.stderr.trim()}\n`);
    return;
  }

  // Push main to the remote so external clones see the latest production code.
  await onStep('- Pushing main branch…\n');
  const remoteUrl = buildAuthRemoteUrl();
  const pushArgs = remoteUrl
    ? ['push', remoteUrl, 'main:main']
    : ['push', 'origin', 'main'];
  const pushResult = await runGit(pushArgs, mainRepoRoot);
  if (pushResult.code !== 0) {
    await onStep(`  ⚠ Could not push main branch: ${pushResult.stderr.trim()}\n`);
  }

  // Check out `main` in the main repo dir (~/primordia) so it tracks the
  // latest production code and doesn't stay on a detached HEAD or old branch.
  await onStep('- Checking out main in ~/primordia…\n');
  const checkoutResult = await runGit(['checkout', 'main'], mainRepoRoot);
  if (checkoutResult.code !== 0) {
    await onStep(`  ⚠ Could not checkout main in ${mainRepoRoot}: ${checkoutResult.stderr.trim()}\n`);
  }
}

/**
 * Asks the reverse proxy to spawn the new production server, health-check it,
 * update primordia.productionBranch in git config, and kill the old server.
 * Streams SSE events from the proxy and pipes each log line through onStep.
 */
async function spawnProdViaProxy(
  branch: string,
  onStep: (text: string) => Promise<void>,
): Promise<void> {
  const proxyPort = process.env.REVERSE_PROXY_PORT!;

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/_proxy/prod/spawn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch }),
    });

    const reader = response.body?.getReader();
    if (!reader) {
      await onStep('⚠️ No response stream from proxy\n');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        try {
          const data = JSON.parse(dataLine.slice(6)) as { type: string; text?: string; ok?: boolean; error?: string };
          if (data.type === 'log' && data.text) await onStep(data.text);
          else if (data.type === 'done' && !data.ok) await onStep(`❌ Proxy spawn failed: ${data.error ?? 'unknown error'}\n`);
        } catch { /* ignore malformed SSE events */ }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await onStep(`⚠️ Could not reach proxy for prod spawn: ${msg}\n`);
  }
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

  // Both typecheck and build passed — ask the proxy to kill the preview dev server.
  console.log(`[retryAcceptAfterFix] typecheck passed, killing preview server for session ${sessionId}`);
  try {
    await fetch(`http://127.0.0.1:${process.env.REVERSE_PROXY_PORT!}/_proxy/preview/${sessionId}`, {
      method: 'DELETE',
    });
  } catch { /* proxy not running — preview server may already be gone */ }

  // ── Merge: blue/green or legacy ────────────────────────────────────────────

  const isProduction = process.env.NODE_ENV === 'production';
  let bgAcceptResult: BlueGreenAcceptResult | null = null;

  if (isProduction) {
    // Blue/green path: build is already done in the worktree, swap the slot.
    console.log(`[retryAcceptAfterFix] blue/green accept for session ${sessionId}`);
    const bgResult = await blueGreenAccept(worktreePath, branch, parentBranch, repoRoot, (text) => appendLogLine(sessionId, text));
    if (!bgResult.ok) {
      console.log(`[retryAcceptAfterFix] blue/green accept failed: ${bgResult.error}`);
      await failWithError(`❌ Accept failed: ${bgResult.error}`);
      return;
    }
    bgAcceptResult = bgResult;
  } else {
    // Legacy path (local dev without systemd).

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
    await appendLogLine(sessionId, '- Merging branch…');
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
          `❌ Accept failed: merge failed and automatic conflict resolution also failed.\n` +
          `Merge error:\n${mergeResult.stderr}\n\nAuto-resolution log:\n${resolution.log}`,
        );
        return;
      }
    }

    if (stashed) await runGit(['stash', 'pop'], mergeRoot);

    // Sync dependencies after merge so the running server reflects any
    // package.json changes that came in from the accepted branch.
    await appendLogLine(sessionId, '- Installing dependencies…');
    console.log(`[retryAcceptAfterFix] running bun install --frozen-lockfile in ${mergeRoot}`);
    const installResult = await runCmd('bun', ['install', '--frozen-lockfile'], mergeRoot);
    console.log(`[retryAcceptAfterFix] bun install exit code=${installResult.code}`);
    if (installResult.code !== 0) {
      await failWithError(
        `❌ Accept failed: \`bun install --frozen-lockfile\` failed after merge.\n` +
        `\`\`\`\n${(installResult.stdout + installResult.stderr).trim()}\n\`\`\``,
      );
      return;
    }

    // Cleanup.
    await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot);
    await runGit(['branch', '-D', branch], repoRoot);
    await runGit(['config', '--remove-section', `branch.${branch}`], repoRoot);
  }

  // Mark as accepted and log the decision.
  console.log(`[retryAcceptAfterFix] merge complete, marking session ${sessionId} as accepted`);
  {
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) {
      appendSessionEvent(ndjsonPath, { type: 'decision', action: 'accepted', detail: isProduction ? 'deployed to production' : `merged into \`${parentBranch}\``, ts: Date.now() });
    }
  }

  // (Production only) Final VACUUM INTO + proxy spawn + slot activation.
  if (isProduction && bgAcceptResult && bgAcceptResult.ok) {
    try { copyDb(process.cwd(), path.resolve(worktreePath)); } catch { /* best-effort */ }
    await spawnProdViaProxy(bgAcceptResult.branch,
      (text) => appendLogLine(sessionId, text));
    // Move the `main` branch pointer to the accepted branch and push it so
    // external clones always reflect the latest production code.
    await moveMainAndPush(worktreePath, bgAcceptResult.branch,
      (text) => appendLogLine(sessionId, text));
    // Run update-service.sh AFTER the proxy has accepted the new prod instance.
    // If the proxy script changed, this will restart primordia-proxy — doing it
    // before spawnProdViaProxy would kill the proxy before it could handle the
    // spawn request, leaving the branch marked accepted but not actually serving.
    await appendLogLine(sessionId, '- Updating service files…');
    const retryUpdateScript = path.join(worktreePath, 'scripts', 'update-service.sh');
    const retryUpdateResult = await runCmd('bash', [retryUpdateScript], worktreePath);
    if (retryUpdateResult.code !== 0) {
      await appendLogLine(sessionId, `  ⚠ update-service.sh exited ${retryUpdateResult.code}: ${(retryUpdateResult.stdout + retryUpdateResult.stderr).trim()}`);
    }
    // Self-terminate: the proxy has switched traffic to the new slot. This old
    // production server's work is done. Delay briefly so the final log write
    // can flush to SQLite before the process exits.
    setTimeout(() => process.exit(0), 1000);
  }
}

/**
 * Runs the long accept steps (type-check, build, merge) asynchronously so
 * the POST handler can return immediately and the client can stream progress
 * via the existing SSE endpoint.
 *
 * Writes step labels to NDJSON events as each stage begins, and sets the
 * session status to "accepted" (or "ready" with error log) when done.
 */
async function runAcceptAsync(
  sessionId: string,
  worktreePath: string,
  branch: string,
  parentBranch: string,
  repoRoot: string,
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
      // Gate 3: TypeScript must compile without errors.
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
        };
        console.log(`[runAcceptAsync] type errors for session ${sessionId}, starting auto-fix`);
        void runFollowupInWorktree(
          autoFixSession, fixPrompt, repoRoot, 'fixing-types',
          (fixedSession) => retryAcceptAfterFix(fixedSession.id, repoRoot, parentBranch),
          /* skipChangelog */ true,
        );
        return;
      }

      // Gate 4: production build must succeed.
      await step('- Building for production…');
      const buildResult = await runCmd('bun', ['run', 'build'], worktreePath);
      if (buildResult.code !== 0) {
        const buildErrors = (buildResult.stdout + buildResult.stderr).trim();
        const buildFixPrompt =
          `The production build failed (\`bun run build\`). Fix all build errors so the build ` +
          `completes successfully. Do not change any runtime behaviour — only fix the build issues.\n\n` +
          `Build output:\n\`\`\`\n${buildErrors}\n\`\`\``;
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
        };
        console.log(`[runAcceptAsync] build errors for session ${sessionId}, starting auto-fix`);
        void runFollowupInWorktree(
          autoFixSession, buildFixPrompt, repoRoot, 'fixing-types',
          (fixedSession) => retryAcceptAfterFix(fixedSession.id, repoRoot, parentBranch),
          /* skipChangelog */ true,
        );
        return;
      }
    }

    // ── Merge: blue/green or legacy ──────────────────────────────────────────
    let bgAcceptResult: BlueGreenAcceptResult | null = null;

    if (isProduction) {
      // Blue/green path: build is already done in the worktree, swap the slot.
      const bgResult = await blueGreenAccept(worktreePath, branch, parentBranch, repoRoot, step);
      if (!bgResult.ok) {
        await failWithError(`❌ Accept failed: ${bgResult.error}`);
        return;
      }
      bgAcceptResult = bgResult;
    } else {
      // Legacy path (local dev without systemd).
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
      await step('- Merging branch…');
      const mergeResult = await runGit(
        ['merge', branch, '--no-ff', '-m', `chore: merge ${branch}`],
        mergeRoot,
      );

      if (mergeResult.code !== 0) {
        const resolution = await resolveConflictsWithClaude(mergeRoot, branch, parentBranch);
        if (!resolution.success) {
          await runGit(['merge', '--abort'], mergeRoot);
          if (stashed) await runGit(['stash', 'pop'], mergeRoot);
          await failWithError(
            `❌ Accept failed: merge failed and automatic conflict resolution also failed.\n` +
            `Merge error:\n${mergeResult.stderr}\n\nAuto-resolution log:\n${resolution.log}`,
          );
          return;
        }
      }

      if (stashed) {
        const popResult = await runGit(['stash', 'pop'], mergeRoot);
        if (popResult.code !== 0) {
          // Non-fatal — log the warning but continue. The merge succeeded.
          await step(`⚠️ Merge succeeded but restoring stashed changes produced a conflict. Run \`git stash pop\` manually to resolve.`);
        }
      }

      // Sync dependencies after merge.
      await step('- Installing dependencies…');
      const installResult = await runCmd('bun', ['install', '--frozen-lockfile'], mergeRoot);
      if (installResult.code !== 0) {
        await failWithError(
          `❌ Accept failed: \`bun install --frozen-lockfile\` failed after merge.\n` +
          `\`\`\`\n${(installResult.stdout + installResult.stderr).trim()}\n\`\`\``,
        );
        return;
      }

      // Cleanup.
      await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot);
      await runGit(['branch', '-D', branch], repoRoot);
      await runGit(['config', '--remove-section', `branch.${branch}`], repoRoot);
    }

    // Mark as accepted (decision event makes inferred status 'accepted').
    {
      const ndjsonPath = getSessionNdjsonPath(worktreePath);
      if (fs.existsSync(ndjsonPath)) {
        appendSessionEvent(ndjsonPath, { type: 'decision', action: 'accepted', detail: isProduction ? 'deployed to production' : `merged into \`${parentBranch}\``, ts: Date.now() });
      }
    }

    // (Production only) Final VACUUM INTO + proxy spawn + slot activation.
    // Done here — after the session is fully written — so the new slot's DB
    // contains the complete "accepted" progress log and status. Without this,
    // the DB copied in blueGreenAccept would be missing the final entries,
    // leaving the session stuck in "Accepting changes" on refresh.
    if (isProduction && bgAcceptResult && bgAcceptResult.ok) {
      try { copyDb(process.cwd(), path.resolve(worktreePath)); } catch { /* best-effort */ }
      await spawnProdViaProxy(bgAcceptResult.branch, step);
      // Move the `main` branch pointer to the accepted branch and push it so
      // external clones always reflect the latest production code.
      await moveMainAndPush(worktreePath, bgAcceptResult.branch, step);
      // Run update-service.sh AFTER the proxy has accepted the new prod instance.
      // If the proxy script changed, this will restart primordia-proxy — doing it
      // before spawnProdViaProxy would kill the proxy before it could handle the
      // spawn request, leaving the branch marked accepted but not actually serving.
      await step('- Updating service files…');
      const updateServiceScript = path.join(worktreePath, 'scripts', 'update-service.sh');
      const updateServiceResult = await runCmd('bash', [updateServiceScript], worktreePath);
      if (updateServiceResult.code !== 0) {
        await step(`  ⚠ update-service.sh exited ${updateServiceResult.code}: ${(updateServiceResult.stdout + updateServiceResult.stderr).trim()}`);
      }
      // Self-terminate: the proxy has switched traffic to the new slot. This old
      // production server's work is done. Delay briefly so the final log write
      // can flush to SQLite before the process exits.
      setTimeout(() => process.exit(0), 1000);
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

  // Ask the reverse proxy to stop the preview dev server for this session.
  try {
    await fetch(`http://127.0.0.1:${process.env.REVERSE_PROXY_PORT!}/_proxy/preview/${body.sessionId}`, {
      method: 'DELETE',
    });
  } catch { /* proxy not running — preview server may already be gone */ }

  const isProduction = process.env.NODE_ENV === 'production';

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

      // ── Gate 3: no concurrent deploy ──────────────────────────────────────
      // Reject if another session is already mid-deploy. Two concurrent accepts
      // would both call spawnProdViaProxy; the second one would overwrite the
      // first deploy with code that was built from the old production branch,
      // effectively rolling back the first deploy's changes.
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
      void runAcceptAsync(body.sessionId, worktreePath, branch, parentBranch, repoRoot);
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
