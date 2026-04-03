// app/api/evolve/manage/route.ts
// Accept or reject a local evolve session — runs in the PARENT server only.
//
// POST
//   Body: { action: "accept" | "reject", sessionId: string }
//
//   accept — looks up the session in SQLite, kills the preview dev server
//            (found by its port via lsof), then performs one of two merge paths:
//
//            BLUE/GREEN (production, when primordia-worktrees/current symlink exists):
//              1. bun install --frozen-lockfile in the session worktree
//              2. Create merge commit via git plumbing (no working-tree writes)
//              3. Detach the session worktree HEAD onto the merge commit
//              4. Health-check the new slot (start on temp port, verify HTTP response)
//              5. Copy production DB into new slot (VACUUM INTO — atomic snapshot)
//              6. Atomically swap the 'current' symlink to the session worktree
//              7. Schedule `sudo systemctl restart primordia` (fire-and-forget)
//              8. Clean up old production slot (if it was a worktree, not the main repo)
//              9. Delete the now-orphaned branch ref
//
//            LEGACY (local dev, no systemd 'current' symlink):
//              git checkout → stash → merge → stash-pop → bun install → worktree remove
//
//   reject — kills the preview dev server, removes the worktree and branch
//            without merging, updates the session status to "rejected".

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { Database } from 'bun:sqlite';
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

/** Append text to a session's progressText without modifying any other field. */
async function appendToProgress(sessionId: string, text: string): Promise<void> {
  const db = await getDb();
  const row = await db.getEvolveSession(sessionId);
  if (!row) return;
  await db.updateEvolveSession(sessionId, { progressText: row.progressText + text });
}

/**
 * Returns the path of the blue/green 'current' symlink if the infrastructure
 * is set up (i.e. primordia-worktrees/current exists as a symlink), else null.
 *
 * The symlink lives in the same directory as the session worktrees so its
 * parent directory can be inferred from any session's worktreePath.
 */
function findCurrentSymlink(worktreePath: string): string | null {
  const candidate = path.join(path.dirname(worktreePath), 'current');
  try {
    return fs.lstatSync(candidate).isSymbolicLink() ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Creates a merge commit in git WITHOUT modifying any working tree.
 *
 * Gate 1 (ancestor check) guarantees that the session branch already contains
 * all commits from parentBranch, so the branch's tree IS the correct merged
 * tree. We use git plumbing to:
 *   1. Build a merge commit object from the branch's tree with both branch tips
 *      as parents.
 *   2. Advance the parentBranch ref to the new commit.
 *
 * The production directory's files are never touched.
 */
async function createMergeCommitNoCheckout(
  repoRoot: string,
  parentBranch: string,
  branch: string,
): Promise<{ commitHash: string } | { error: string }> {
  const [treeRes, parentRes, branchRes] = await Promise.all([
    runGit(['rev-parse', `${branch}^{tree}`], repoRoot),
    runGit(['rev-parse', `refs/heads/${parentBranch}`], repoRoot),
    runGit(['rev-parse', `refs/heads/${branch}`], repoRoot),
  ]);
  for (const r of [treeRes, parentRes, branchRes]) {
    if (r.code !== 0) return { error: r.stderr };
  }

  const commitRes = await runGit(
    [
      'commit-tree', treeRes.stdout.trim(),
      '-p', parentRes.stdout.trim(),
      '-p', branchRes.stdout.trim(),
      '-m', `chore: merge ${branch}`,
    ],
    repoRoot,
  );
  if (commitRes.code !== 0) return { error: commitRes.stderr };

  const mergeCommit = commitRes.stdout.trim();
  const updateRes = await runGit(
    ['update-ref', `refs/heads/${parentBranch}`, mergeCommit],
    repoRoot,
  );
  if (updateRes.code !== 0) return { error: updateRes.stderr };

  return { commitHash: mergeCommit };
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

/** Returns an available TCP port on 127.0.0.1 (OS picks one). */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * Starts the built production server from slotPath on a temporary free port
 * and verifies it responds to HTTP. Returns { ok: true } on success.
 * Kills the test server when done regardless of outcome.
 */
async function healthCheckSlot(slotPath: string): Promise<{ ok: boolean; error?: string }> {
  const port = await findFreePort();
  const server = spawn('bun', ['run', 'start'], {
    cwd: slotPath,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
    detached: false,
  });

  let spawnError: string | undefined;
  let exitCode: number | null = null;
  server.on('error', (err: Error) => { spawnError = err.message; });
  server.on('exit', (code) => { exitCode = code ?? 1; });

  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      if (spawnError) return { ok: false, error: `Server process error: ${spawnError}` };
      if (exitCode !== null) return { ok: false, error: `Server exited early with code ${exitCode}` };
      try {
        await fetch(`http://localhost:${port}/`, {
          signal: AbortSignal.timeout(3_000),
          redirect: 'manual',
        });
        return { ok: true };
      } catch {
        // Not ready yet — keep polling
      }
    }
    return { ok: false, error: 'Health check timed out after 30s' };
  } finally {
    server.kill('SIGTERM');
    // Brief pause to let the process release its port binding
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/**
 * Blue/green accept path.
 *
 * Builds and activates the session worktree as the new production slot without
 * running any git or bun commands in the live production directory.
 *
 * Returns null on success, or an error message string on failure.
 */
async function blueGreenAccept(
  currentSymlink: string,
  worktreePath: string,
  branch: string,
  parentBranch: string,
  repoRoot: string,
  onStep: (text: string) => Promise<void> = async () => {},
): Promise<string | null> {
  // Step 1: ensure node_modules are up to date in the session worktree.
  // This is the only bun install that runs, and it runs in the worktree (not production).
  await onStep('- Installing dependencies…\n');
  const installResult = await runCmd('bun', ['install', '--frozen-lockfile'], worktreePath);
  if (installResult.code !== 0) {
    return (
      `bun install --frozen-lockfile failed in session worktree:\n` +
      (installResult.stdout + installResult.stderr).trim()
    );
  }

  // Step 2: create the merge commit in git history without touching any working tree.
  const mergeRes = await createMergeCommitNoCheckout(repoRoot, parentBranch, branch);
  if ('error' in mergeRes) {
    return `Failed to create merge commit: ${mergeRes.error}`;
  }
  const mergeCommit = mergeRes.commitHash;

  // Step 3: detach the session worktree HEAD onto the merge commit.
  // The files are already correct (same tree — guaranteed by Gate 1), so this
  // is effectively a no-op for file content and just updates HEAD.
  // Detaching from the named branch ref allows us to delete the branch afterwards.
  await runGit(['checkout', '--detach', mergeCommit], worktreePath);

  // Step 4: read the current slot before swapping so we can handle it afterwards.
  const oldSlot = path.resolve(fs.readlinkSync(currentSymlink));

  // Resolve the main git repo root so we never accidentally remove it.
  // 'git rev-parse --git-common-dir' in any worktree returns the shared .git path;
  // dirname of that is the main repo directory, which is stable and never deleted.
  const gitCommonResult = await runGit(['rev-parse', '--git-common-dir'], worktreePath);
  const mainRepoRoot = gitCommonResult.code === 0
    ? path.dirname(path.resolve(worktreePath, gitCommonResult.stdout.trim()))
    : path.resolve(repoRoot); // fallback: assume repoRoot is the main repo

  // Step 4a: Health-check the new slot before committing to the swap.
  // Starts the production server on a temporary free port and verifies it serves HTTP.
  await onStep('- Health-checking new slot…\n');
  const healthCheck = await healthCheckSlot(path.resolve(worktreePath));
  if (!healthCheck.ok) {
    return `New slot failed health check: ${healthCheck.error ?? 'server did not respond'}`;
  }

  // Step 4b: Copy the production database into the new slot via VACUUM INTO —
  // an atomic, consistent snapshot safe to take while the live server writes.
  try {
    copyDb(oldSlot, path.resolve(worktreePath));
  } catch {
    // Non-fatal: the worktree's existing DB snapshot from session creation is still usable.
  }

  // Step 4c: Fix the .env.local symlink in the new slot so it always points
  // directly to the main repo's copy — which is never deleted. Without this,
  // the symlink would point to the old slot's .env.local, which gets cleaned up
  // on the next accept, leaving a dangling link.
  const mainEnvPath = path.join(mainRepoRoot, '.env.local');
  const worktreeEnvPath = path.join(path.resolve(worktreePath), '.env.local');
  if (fs.existsSync(mainEnvPath)) {
    fs.rmSync(worktreeEnvPath, { force: true });
    fs.symlinkSync(mainEnvPath, worktreeEnvPath);
  }

  // Step 5: atomically swap the symlink.
  // ln -sfn creates the new symlink at a temp path; renameSync replaces the
  // old symlink in a single atomic rename(2) syscall.
  await onStep('- Activating new slot…\n');
  const tmpLink = currentSymlink + '.tmp';
  fs.symlinkSync(path.resolve(worktreePath), tmpLink);
  fs.renameSync(tmpLink, currentSymlink);

  // Step 6: Preserve the old slot as 'previous' for fast rollback, and clean up
  // whatever was 'previous' before (two accepts ago).
  const previousSymlink = path.join(path.dirname(currentSymlink), 'previous');

  // Read the slot that was 'previous' before this accept so we can remove it.
  let veryOldSlot: string | null = null;
  try {
    const prevTarget = fs.readlinkSync(previousSymlink);
    veryOldSlot = path.resolve(prevTarget);
  } catch { /* no previous slot yet — first or second accept */ }

  // Atomically move 'previous' to point at the slot we just retired.
  const tmpPrev = previousSymlink + '.tmp';
  if (oldSlot !== mainRepoRoot) {
    // Only create a 'previous' symlink when the old slot is a worktree (not main).
    // If old slot IS the main repo it will stick around forever anyway.
    fs.symlinkSync(oldSlot, tmpPrev);
    fs.renameSync(tmpPrev, previousSymlink);
  }

  // Remove the slot that was 'previous' before this accept (two accepts ago),
  // unless it is the main git repository, which must never be removed.
  if (veryOldSlot && veryOldSlot !== mainRepoRoot) {
    await runGit(['worktree', 'remove', '--force', veryOldSlot], repoRoot);
  }

  // Step 7: delete the now-orphaned branch ref (HEAD is detached, so this succeeds).
  await runGit(['branch', '-D', branch], repoRoot);
  await runGit(['config', '--remove-section', `branch.${branch}`], repoRoot);

  // Step 7b: re-attach the new slot's HEAD to the parent branch so that
  // branch-detection logic (e.g. /branches page) works correctly in production.
  // Git forbids two worktrees from having the same branch checked out
  // simultaneously, so we must detach HEAD in the old slot first.
  await runGit(['checkout', '--detach'], oldSlot);
  await runGit(['checkout', parentBranch], worktreePath);

  // Step 8: schedule the systemd service restart fire-and-forget.
  // The 500 ms delay gives the HTTP response time to flush before the process dies.
  await onStep('- Restarting service…\n');
  setTimeout(() => {
    try { execSync('sudo systemctl restart primordia', { stdio: 'ignore' }); } catch { /* best-effort */ }
  }, 500);

  return null; // success
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
    await appendToProgress(sessionId, msg);
    await db.updateEvolveSession(sessionId, { status: 'error' });
  }

  // Re-run the TypeScript check to verify the fix worked.
  await appendToProgress(sessionId, '- Re-checking TypeScript types…\n');
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

  // Also verify the production build succeeds.
  await appendToProgress(sessionId, '- Re-building for production…\n');
  console.log(`[retryAcceptAfterFix] re-running build in ${worktreePath}`);
  const buildResult = await runCmd('bun', ['run', 'build'], worktreePath);
  console.log(`[retryAcceptAfterFix] build exit code=${buildResult.code}`);
  if (buildResult.code !== 0) {
    const buildErrors = (buildResult.stdout + buildResult.stderr).trim();
    console.log(`[retryAcceptAfterFix] build still failing:\n${buildErrors}`);
    await failWithError(
      `\n\n❌ **Auto-fix failed**: Production build still failing after the fix attempt.\n\n\`\`\`\n${buildErrors}\n\`\`\`\n`,
    );
    return;
  }

  // Both typecheck and build passed — kill the preview dev server.
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

  // ── Merge: blue/green or legacy ────────────────────────────────────────────

  const currentSymlink = findCurrentSymlink(worktreePath);

  if (currentSymlink) {
    // Blue/green path: build is already done in the worktree, swap the slot.
    console.log(`[retryAcceptAfterFix] blue/green accept for session ${sessionId}`);
    const err = await blueGreenAccept(currentSymlink, worktreePath, branch, parentBranch, repoRoot, (text) => appendToProgress(sessionId, text));
    if (err) {
      console.log(`[retryAcceptAfterFix] blue/green accept failed: ${err}`);
      await failWithError(`\n\n❌ **Accept failed**: ${err}\n`);
      return;
    }
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
    await appendToProgress(sessionId, '- Merging branch…\n');
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
    await appendToProgress(sessionId, '- Installing dependencies…\n');
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

    // Cleanup.
    await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot);
    await runGit(['branch', '-D', branch], repoRoot);
    await runGit(['config', '--remove-section', `branch.${branch}`], repoRoot);
  }

  // Mark as accepted and log the decision.
  console.log(`[retryAcceptAfterFix] merge complete, marking session ${sessionId} as accepted`);
  await appendToProgress(sessionId, `\n\n---\n\n✅ **Accepted** — merged into \`${parentBranch}\`\n`);
  await db.updateEvolveSession(sessionId, { status: 'accepted' });
}

/**
 * Runs the long accept steps (type-check, build, merge) asynchronously so
 * the POST handler can return immediately and the client can stream progress
 * via the existing SSE endpoint.
 *
 * Writes step labels to progressText as each stage begins, and sets the
 * session status to "accepted" or "error" when done.
 */
async function runAcceptAsync(
  sessionId: string,
  worktreePath: string,
  branch: string,
  parentBranch: string,
  repoRoot: string,
): Promise<void> {
  const step = (text: string) => appendToProgress(sessionId, text);

  async function failWithError(msg: string): Promise<void> {
    await appendToProgress(sessionId, msg);
    const db = await getDb();
    await db.updateEvolveSession(sessionId, { status: 'error' });
  }

  try {
    const db = await getDb();

    // Gate 3: TypeScript must compile without errors.
    await step('- Type-checking…\n');
    const tscResult = await runCmd('bun', ['run', 'typecheck'], worktreePath);
    if (tscResult.code !== 0) {
      const typeErrors = (tscResult.stdout + tscResult.stderr).trim();
      const fixPrompt =
        `The TypeScript type check failed. Fix all type errors so the code compiles ` +
        `without errors. Do not change any runtime behaviour — only fix the type issues.\n\n` +
        `TypeScript compiler output:\n\`\`\`\n${typeErrors}\n\`\`\``;
      const session = await db.getEvolveSession(sessionId);
      if (!session) return;
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
      console.log(`[runAcceptAsync] type errors for session ${sessionId}, starting auto-fix`);
      await db.updateEvolveSession(sessionId, { status: 'fixing-types' });
      void runFollowupInWorktree(
        autoFixSession, fixPrompt, repoRoot, 'fixing-types',
        (fixedSession) => retryAcceptAfterFix(fixedSession.id, repoRoot, parentBranch),
        /* skipChangelog */ true,
      );
      return;
    }

    // Gate 4: production build must succeed.
    await step('- Building for production…\n');
    const buildResult = await runCmd('bun', ['run', 'build'], worktreePath);
    if (buildResult.code !== 0) {
      const buildErrors = (buildResult.stdout + buildResult.stderr).trim();
      const buildFixPrompt =
        `The production build failed (\`bun run build\`). Fix all build errors so the build ` +
        `completes successfully. Do not change any runtime behaviour — only fix the build issues.\n\n` +
        `Build output:\n\`\`\`\n${buildErrors}\n\`\`\``;
      const session = await db.getEvolveSession(sessionId);
      if (!session) return;
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
      console.log(`[runAcceptAsync] build errors for session ${sessionId}, starting auto-fix`);
      await db.updateEvolveSession(sessionId, { status: 'fixing-types' });
      void runFollowupInWorktree(
        autoFixSession, buildFixPrompt, repoRoot, 'fixing-types',
        (fixedSession) => retryAcceptAfterFix(fixedSession.id, repoRoot, parentBranch),
        /* skipChangelog */ true,
      );
      return;
    }

    // ── Merge: blue/green or legacy ──────────────────────────────────────────

    const currentSymlink = findCurrentSymlink(worktreePath);

    if (currentSymlink) {
      // Blue/green path: build is already done in the worktree, swap the slot.
      const err = await blueGreenAccept(currentSymlink, worktreePath, branch, parentBranch, repoRoot, step);
      if (err) {
        await failWithError(`\n\n❌ **Accept failed**: ${err}\n`);
        return;
      }
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
            `\n\n❌ **Accept failed**: \`git checkout ${parentBranch}\` failed:\n${checkoutResult.stderr}\n`,
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
      await step('- Merging branch…\n');
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
            `\n\n❌ **Accept failed**: merge failed and automatic conflict resolution also failed.\n\n` +
            `Merge error:\n${mergeResult.stderr}\n\nAuto-resolution log:\n${resolution.log}\n`,
          );
          return;
        }
      }

      if (stashed) {
        const popResult = await runGit(['stash', 'pop'], mergeRoot);
        if (popResult.code !== 0) {
          // Non-fatal — log the warning but continue. The merge succeeded.
          await step(`\n⚠️ Merge succeeded but restoring stashed changes produced a conflict. Run \`git stash pop\` manually to resolve.\n\n`);
        }
      }

      // Sync dependencies after merge.
      await step('- Installing dependencies…\n');
      const installResult = await runCmd('bun', ['install', '--frozen-lockfile'], mergeRoot);
      if (installResult.code !== 0) {
        await failWithError(
          `\n\n❌ **Accept failed**: \`bun install --frozen-lockfile\` failed after merge. ` +
          `The lockfile may be out of sync with package.json.\n\n` +
          `\`\`\`\n${(installResult.stdout + installResult.stderr).trim()}\n\`\`\`\n`,
        );
        return;
      }

      // Cleanup.
      await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot);
      await runGit(['branch', '-D', branch], repoRoot);
      await runGit(['config', '--remove-section', `branch.${branch}`], repoRoot);
    }

    // Mark as accepted.
    await appendToProgress(sessionId, `\n\n---\n\n✅ **Accepted** — merged into \`${parentBranch}\`\n`);
    await db.updateEvolveSession(sessionId, { status: 'accepted' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runAcceptAsync] unexpected error for session ${sessionId}:`, err);
    await failWithError(`\n\n❌ **Accept failed** (unexpected error): ${msg}\n`).catch(() => {});
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

      // ── Kick off async accept ──────────────────────────────────────────────
      // Gates 1+2 pass synchronously. The remaining work (type-check, build,
      // merge) runs fire-and-forget so the client receives a response immediately
      // and can stream progress via SSE.
      const acceptingRow = await db.getEvolveSession(body.sessionId);
      if (acceptingRow) {
        await db.updateEvolveSession(body.sessionId, {
          status: 'accepting',
          progressText: acceptingRow.progressText + `\n\n### 🚀 Merging into ${parentBranch}\n\n`,
          port: acceptingRow.port,
          previewUrl: acceptingRow.previewUrl,
        });
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
