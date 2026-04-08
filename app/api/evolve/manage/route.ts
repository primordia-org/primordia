// app/api/evolve/manage/route.ts
// Accept or reject a local evolve session — runs in the PARENT server only.
//
// POST
//   Body: { action: "accept" | "reject", sessionId: string }
//
//   accept — looks up the session in SQLite, kills the preview dev server
//            (found by its port via lsof), then performs one of two merge paths:
//
//            BLUE/GREEN (production, when NODE_ENV === 'production'):
//              1. bun install --frozen-lockfile in the session worktree
//              2. Create merge commit via git plumbing; advance parentBranch and fast-forward
//                 the session branch ref to the same merge commit (no working-tree writes)
//              3. Start new prod server on branch's pre-assigned port (git config); health-check it
//              4. Copy production DB into new slot (VACUUM INTO — atomic snapshot)
//              5. Set PROD symbolic-ref → session branch; proxy switches instantly
//              6. Old slot kept indefinitely as registered git worktree (enables deep rollback via /admin/rollback)
//              7. Session worktree stays checked out on the session branch; old slot keeps its branch
//              8. Persist "accepted" status + final progress log to DB
//              9. Final VACUUM INTO new slot DB (captures complete accepted state)
//             10. Set PROD symbolic-ref → session branch + touch git config → proxy switches; SIGTERM old server
//
//            LEGACY (local dev, NODE_ENV !== 'production'):
//              git checkout → stash → merge → stash-pop → bun install → worktree remove
//
//   reject — kills the preview dev server, removes the worktree and branch
//            without merging, updates the session status to "rejected".

import { execSync, execFileSync, spawn } from 'child_process';
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

type BlueGreenAcceptResult =
  | { ok: false; error: string }
  | { ok: true; branch: string; newProdPort: number | null; oldUpstreamPort: number | null };

/**
 * Blue/green accept path.
 *
 * Builds and activates the session worktree as the new production slot without
 * running any git or bun commands in the live production directory.
 *
 * Returns { ok: false, error } on failure, or { ok: true, newProdPort, oldUpstreamPort } on success.
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

  // Find the current production slot via the PROD symbolic-ref.
  // Falls back to the main repo on the very first accept (before PROD is set).
  let oldSlot: string = mainRepoRoot;
  try {
    const prodBranch = execFileSync('git', ['symbolic-ref', '--short', 'PROD'], {
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
    // PROD not yet set — fall through to mainRepoRoot default
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

  // Step 2: create the merge commit in git history without touching any working tree.
  const mergeRes = await createMergeCommitNoCheckout(repoRoot, parentBranch, branch);
  if ('error' in mergeRes) {
    return { ok: false, error: `Failed to create merge commit: ${mergeRes.error}` };
  }
  const mergeCommit = mergeRes.commitHash;

  // Fast-forward the session branch ref to the merge commit so the session
  // worktree (whose HEAD is "ref: refs/heads/${branch}") lands on the merge
  // commit without a checkout. The files are already correct (same tree —
  // guaranteed by Gate 1). No detach is needed since we keep the branch alive.
  const ffRes = await runGit(['update-ref', `refs/heads/${branch}`, mergeCommit], repoRoot);
  if (ffRes.code !== 0) {
    return { ok: false, error: `Failed to fast-forward session branch to merge commit: ${ffRes.stderr}` };
  }

  // Step 3 (old: detach HEAD) removed — the session worktree stays checked out
  // on the session branch, which now points to the merge commit.

  // Step 4a: Start the new prod server on the branch's pre-assigned port.
  // The preview dev server was already killed in the POST handler before
  // runAcceptAsync was called, so this port is free by the time we reach here.
  await onStep('- Health-checking new slot…\n');
  let newProdPort: number;
  try {
    const portOut = execFileSync('git', ['config', '--get', `branch.${branch}.port`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    newProdPort = parseInt(portOut, 10);
    if (!newProdPort) throw new Error('empty port');
  } catch {
    // Fallback: find a free port (e.g. migration script hasn't run yet)
    newProdPort = await findFreePort();
  }
  const newServer = spawn('bun', ['run', 'start'], {
    cwd: path.resolve(worktreePath),
    env: { ...process.env, PORT: String(newProdPort), HOSTNAME: '0.0.0.0' },
    stdio: 'ignore',
    detached: true,
  });
  newServer.unref();

  let spawnError: string | undefined;
  let exitCode: number | null = null;
  newServer.on('error', (err: Error) => { spawnError = err.message; });
  newServer.on('exit', (code) => { exitCode = code ?? 1; });

  let healthOk = false;
  let healthError: string | undefined;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    if (spawnError) { healthError = `Server process error: ${spawnError}`; break; }
    if (exitCode !== null) { healthError = `Server exited early with code ${exitCode}`; break; }
    try {
      await fetch(`http://localhost:${newProdPort}/`, {
        signal: AbortSignal.timeout(3_000),
        redirect: 'manual',
      });
      healthOk = true;
      break;
    } catch {
      // Not ready yet — keep polling
    }
  }
  if (!healthOk) {
    try { newServer.kill('SIGTERM'); } catch { /* already gone */ }
    return { ok: false, error: `New slot failed health check: ${healthError ?? 'server did not respond'}` };
  }

  // Read the old upstream port from git config (the parent branch's current port).
  let oldUpstreamPort: number | null = null;
  try {
    const portOut = execFileSync('git', ['config', '--get', `branch.${parentBranch}.port`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (portOut) oldUpstreamPort = parseInt(portOut, 10);
  } catch { /* branch port not yet assigned */ }

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

  await onStep('- Activating new slot…\n');

  // The session worktree remains checked out on the session branch (now fast-
  // forwarded to the merge commit). The old slot retains whatever branch it had
  // before — no detach or checkout is needed since both slots are on distinct
  // branches. The PROD symbolic-ref is updated in scheduleSlotActivation after
  // the DB is fully written, so the proxy switches atomically to the new slot.

  // The caller schedules the final VACUUM INTO + PROD update AFTER persisting
  // the "accepted" state to the DB, so the new slot's DB contains the complete
  // progress log and is not truncated on refresh.
  return { ok: true, branch, newProdPort, oldUpstreamPort };
}

/**
 * Activates the new production slot after all DB writes are complete.
 *
 * If REVERSE_PROXY_PORT is set (proxy in use): sets the PROD symbolic-ref to
 * the session branch so the reverse proxy routes to the new server, then
 * gracefully kills the old server via lsof on its former port.
 *
 * Falls back to `sudo systemctl restart primordia-proxy` when the proxy is not
 * configured (e.g. initial setup or local dev accidentally running in
 * production mode).
 */
function scheduleSlotActivation(
  worktreePath: string,
  branch: string,
  newProdPort: number | null,
  oldUpstreamPort: number | null,
  parentBranch: string,
  repoRoot: string,
): void {
  const useProxy = !!process.env.REVERSE_PROXY_PORT && newProdPort !== null;

  if (useProxy) {
    // Set PROD symbolic-ref so the proxy routes to the new session branch.
    try {
      execFileSync('git', ['symbolic-ref', 'PROD', `refs/heads/${branch}`], {
        cwd: repoRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch { /* best-effort */ }

    // Re-write the session branch port in git config (same value, but the write
    // touches .git/config and fires the proxy's fs.watch so it reads the updated
    // PROD ref immediately rather than waiting for the 5 s safety-net poll).
    try {
      execFileSync('git', ['config', `branch.${branch}.port`, String(newProdPort)], {
        cwd: repoRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch { /* best-effort */ }

    // Give the proxy ~500 ms to pick up the new config, then kill the old server.
    setTimeout(() => {
      if (oldUpstreamPort !== null) {
        try {
          const pids = execSync(`lsof -ti tcp:${oldUpstreamPort}`, { encoding: 'utf8' })
            .trim().split('\n').filter(Boolean).map(Number).filter(Boolean);
          for (const pid of pids) {
            try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
          }
        } catch { /* no process on that port */ }
      }
    }, 500);
  } else {
    // Fallback: restart the proxy (brief downtime window; proxy will start new prod server).
    setTimeout(() => {
      try { execSync('sudo systemctl restart primordia-proxy', { stdio: 'ignore' }); } catch { /* best-effort */ }
    }, 500);
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

  /** Append text and mark the session ready (with error in the log). */
  async function failWithError(msg: string): Promise<void> {
    await appendToProgress(sessionId, msg);
    await db.updateEvolveSession(sessionId, { status: 'ready' });
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

  const isProduction = process.env.NODE_ENV === 'production';
  let bgAcceptResult: BlueGreenAcceptResult | null = null;

  if (isProduction) {
    // Blue/green path: build is already done in the worktree, swap the slot.
    console.log(`[retryAcceptAfterFix] blue/green accept for session ${sessionId}`);
    const bgResult = await blueGreenAccept(worktreePath, branch, parentBranch, repoRoot, (text) => appendToProgress(sessionId, text));
    if (!bgResult.ok) {
      console.log(`[retryAcceptAfterFix] blue/green accept failed: ${bgResult.error}`);
      await failWithError(`\n\n❌ **Accept failed**: ${bgResult.error}\n`);
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

  // (Production only) Final VACUUM INTO + slot activation — same as runAcceptAsync.
  if (isProduction && bgAcceptResult && bgAcceptResult.ok) {
    await appendToProgress(sessionId, '- Switching traffic to new slot…\n');
    try { copyDb(process.cwd(), path.resolve(worktreePath)); } catch { /* best-effort */ }
    scheduleSlotActivation(worktreePath, bgAcceptResult.branch, bgAcceptResult.newProdPort, bgAcceptResult.oldUpstreamPort, parentBranch, repoRoot);
  }
}

/**
 * Runs the long accept steps (type-check, build, merge) asynchronously so
 * the POST handler can return immediately and the client can stream progress
 * via the existing SSE endpoint.
 *
 * Writes step labels to progressText as each stage begins, and sets the
 * session status to "accepted" (or "ready" with error log) when done.
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
    await db.updateEvolveSession(sessionId, { status: 'ready' });
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

    const isProduction = process.env.NODE_ENV === 'production';
    let bgAcceptResult: BlueGreenAcceptResult | null = null;

    if (isProduction) {
      // Blue/green path: build is already done in the worktree, swap the slot.
      const bgResult = await blueGreenAccept(worktreePath, branch, parentBranch, repoRoot, step);
      if (!bgResult.ok) {
        await failWithError(`\n\n❌ **Accept failed**: ${bgResult.error}\n`);
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

    // (Production only) Final VACUUM INTO + slot activation.
    // Done here — after the session is fully written — so the new slot's DB
    // contains the complete "accepted" progress log and status. Without this,
    // the DB copied in blueGreenAccept (Step 4b) would be missing the final
    // entries, leaving the session stuck in "Accepting changes" on refresh.
    if (isProduction && bgAcceptResult && bgAcceptResult.ok) {
      await step('- Switching traffic to new slot…\n');
      try { copyDb(process.cwd(), path.resolve(worktreePath)); } catch { /* best-effort */ }
      scheduleSlotActivation(worktreePath, bgAcceptResult.branch, bgAcceptResult.newProdPort, bgAcceptResult.oldUpstreamPort, parentBranch, repoRoot);
    }
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
