// lib/evolve-sessions.ts
// Helpers for the local evolve flow.
// Only used when NODE_ENV=development.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  appendSessionEvent,
  readSessionEvents,
  getSessionNdjsonPath,
  listSessionsFromFilesystem,
  type SessionEvent,
} from './session-events';

export type LocalSessionStatus =
  | 'starting'
  | 'running-claude'
  | 'fixing-types'
  | 'ready'
  | 'accepting'
  | 'accepted'
  | 'rejected';

export type DevServerStatus =
  | 'none'
  | 'starting'
  | 'running'
  | 'disconnected';

export interface LocalSession {
  id: string;
  branch: string;
  worktreePath: string;
  status: LocalSessionStatus;
  devServerStatus: DevServerStatus;
  port: number | null;
  previewUrl: string | null;
  /** The original change request text submitted by the user. */
  request: string;
  /** Unix timestamp (ms) when the session was created. */
  createdAt: number;
}

// ─── Branch port management ────────────────────────────────────────────────────

const WORKTREES_DIR =
  process.env.PRIMORDIA_WORKTREES_DIR ?? '/home/exedev/primordia-worktrees';

/**
 * Returns the ephemeral port assigned to a branch in git config, assigning a
 * new one if not yet set. Idempotent: running twice on the same branch returns
 * the same port. Port 3001 is reserved for the main production branch.
 */
function getOrAssignBranchPort(branch: string, repoRoot: string): number {
  const { execFileSync } = require('child_process') as typeof import('child_process');

  // Return existing assignment if present.
  try {
    const out = execFileSync('git', ['config', '--get', `branch.${branch}.port`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (out) return parseInt(out, 10);
  } catch { /* not set yet */ }

  // Collect all currently assigned ports to avoid conflicts.
  const assigned = new Set<number>();
  try {
    const out = execFileSync('git', ['config', '--get-regexp', 'branch\\..*\\.port'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const line of out.trim().split('\n')) {
      const m = line.match(/\s+(\d+)$/);
      if (m) assigned.add(parseInt(m[1], 10));
    }
  } catch { /* no ports assigned yet */ }

  // Assign the next available port starting from 3001.
  let port = 3001;
  while (assigned.has(port)) port++;

  try {
    execFileSync('git', ['config', `branch.${branch}.port`, String(port)], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.error(`[evolve] failed to assign port ${port} to branch ${branch}:`, err);
  }

  return port;
}

// ─── Worker process management ────────────────────────────────────────────────

/** Config passed to the standalone Claude worker process via a temp JSON file. */
interface WorkerConfig {
  sessionId: string;
  worktreePath: string;
  repoRoot: string;
  prompt: string;
  timeoutMs: number;
  /** When true, continue the most recent Claude Code session in the worktree directory. */
  useContinue?: boolean;
}

/** Maps session IDs to the PID of their running Claude worker process. */
const activeWorkerPids = new Map<string, number>();

/** Returns true if the OS process with the given PID is still alive. */
function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Throws if a Claude Code worker is already running in the given worktree,
 * guarding against concurrent workers that would clobber each other's work.
 *
 * Reads the PID from `.primordia-worker.pid` (written by the worker on
 * startup). If the PID file exists but the process is gone, the stale file
 * is removed so the next launch can proceed.
 */
function checkWorktreeNotBusy(worktreePath: string): void {
  const pidFile = path.join(worktreePath, '.primordia-worker.pid');
  if (!fs.existsSync(pidFile)) return;
  const pidStr = fs.readFileSync(pidFile, 'utf8').trim();
  const pid = parseInt(pidStr, 10);
  if (!isNaN(pid) && isProcessAlive(pid)) {
    throw new Error(
      `A Claude Code worker (PID ${pid}) is already running in this worktree. ` +
      `Wait for it to finish or abort the current session before starting another.`,
    );
  }
  // Stale PID file — process is gone, clean it up.
  try { fs.rmSync(pidFile, { force: true }); } catch { /* best-effort */ }
}

/**
 * Spawns a detached Claude Code worker process for the given config.
 * The worker process is independent of the server — it survives server
 * restarts. Awaiting this function waits for the worker to exit.
 *
 * If the server exits while this is awaited, the worker keeps running.
 * On server restart, reconnectRunningWorkers() re-attaches to live workers.
 */
async function spawnClaudeWorker(
  config: WorkerConfig,
  workerScriptPath: string,
): Promise<void> {
  checkWorktreeNotBusy(config.worktreePath);

  const configFile = `/tmp/primordia-worker-${config.sessionId}.json`;
  fs.writeFileSync(configFile, JSON.stringify(config), 'utf8');

  return new Promise<void>((resolve, reject) => {
    const proc = spawn('bun', ['run', workerScriptPath, configFile], {
      cwd: config.repoRoot,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!proc.pid) {
      fs.rmSync(configFile, { force: true });
      reject(new Error('Failed to spawn Claude worker: no PID assigned'));
      return;
    }

    // Unref so the worker keeps running even if the server exits.
    proc.unref();
    activeWorkerPids.set(config.sessionId, proc.pid);

    // Forward worker output to server logs.
    proc.stdout?.on('data', (data: Buffer) => process.stdout.write(data));
    proc.stderr?.on('data', (data: Buffer) => process.stderr.write(data));

    proc.on('exit', () => {
      activeWorkerPids.delete(config.sessionId);
      try { fs.rmSync(configFile, { force: true }); } catch { /* best-effort */ }
      resolve();
    });

    proc.on('error', (err: Error) => {
      activeWorkerPids.delete(config.sessionId);
      try { fs.rmSync(configFile, { force: true }); } catch { /* best-effort */ }
      reject(new Error(`Claude worker spawn failed: ${err.message}`));
    });
  });
}

/**
 * On server startup: reconnect to any Claude worker processes that survived
 * from before the restart. For each session in a running state:
 *   - If the worker's PID file exists and the process is alive, register its
 *     PID so abortClaudeRun() can still send SIGTERM to it.
 *   - If the PID file is missing or the process is dead, mark the session as
 *     'ready' with a recovery note (consistent with the abort endpoint behavior).
 *
 * Call this once from instrumentation.ts when the server starts.
 */
export async function reconnectRunningWorkers(repoRoot: string): Promise<void> {
  const sessions = listSessionsFromFilesystem(repoRoot);
  const runningStatuses = new Set(['running-claude', 'fixing-types', 'starting']);

  for (const record of sessions) {
    if (!runningStatuses.has(record.status)) continue;

    const pidFile = path.join(record.worktreePath, '.primordia-worker.pid');
    let livePid: number | null = null;

    if (fs.existsSync(pidFile)) {
      const pidStr = fs.readFileSync(pidFile, 'utf8').trim();
      const parsed = parseInt(pidStr, 10);
      if (!isNaN(parsed) && isProcessAlive(parsed)) {
        livePid = parsed;
      }
    }

    if (livePid === null) {
      // Worker is gone — recover the session so it isn't stuck forever.
      // Append a 'result: aborted' event so inferStatusFromEvents() returns 'ready'.
      const recoveryMessage = record.status === 'fixing-types'
        ? 'Session recovered after server restart. Auto-accept was cancelled — you can accept or reject manually.'
        : 'Session recovered after server restart.';
      const ndjsonPath = getSessionNdjsonPath(record.worktreePath);
      if (fs.existsSync(ndjsonPath)) {
        appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'aborted', message: recoveryMessage, ts: Date.now() });
      }
      if (fs.existsSync(pidFile)) {
        try { fs.rmSync(pidFile, { force: true }); } catch { /* best-effort */ }
      }
      continue;
    }

    // Worker is still running — register it so abortClaudeRun() works.
    activeWorkerPids.set(record.id, livePid);
    // Background: unregister PID when the worker eventually finishes.
    const sessionId = record.id;
    void (async () => {
      while (isProcessAlive(livePid!)) {
        await new Promise<void>((r) => setTimeout(r, 2000));
      }
      activeWorkerPids.delete(sessionId);
    })();
  }
}

/**
 * Signals the running Claude Code worker for the given session to stop.
 * Returns true if a live worker was found and signalled, false if the
 * session has no registered worker PID.
 */
export function abortClaudeRun(sessionId: string): boolean {
  const pid = activeWorkerPids.get(sessionId);
  if (pid === undefined) return false;
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    // Worker may have already exited.
    activeWorkerPids.delete(sessionId);
    return false;
  }
}

// ─── Git ──────────────────────────────────────────────────────────────────────

export function runGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, code: 1 }));
  });
}

// ─── Worktree helpers ─────────────────────────────────────────────────────────

/**
 * Parse `git worktree list --porcelain` output and return the worktree path
 * that is currently checked out on `branchName`, or null if none.
 */
function parseWorktreePathForBranch(porcelain: string, branchName: string): string | null {
  let currentPath: string | null = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim();
    } else if (line.startsWith('branch refs/heads/')) {
      const branch = line.slice('branch refs/heads/'.length).trim();
      if (branch === branchName && currentPath !== null) {
        return currentPath;
      }
    }
  }
  return null;
}

// ─── Main flow ────────────────────────────────────────────────────────────────

export async function startLocalEvolve(
  session: LocalSession,
  taskRequest: string,
  repoRoot: string,
  /** @deprecated No longer used — preview URLs are derived from the session ID. */
  _publicOrigin: string = "http://localhost",
  /** Temporary file paths for user-uploaded attachments. Copied into worktree/attachments/ and deleted from /tmp. */
  attachmentPaths: string[] = [],
  /** Extra options for advanced use cases. */
  options: {
    /**
     * When true, skip `git worktree add -b <branch>` (branch already exists).
     * Instead runs `git worktree add <path> <branch>` to check out the existing branch.
     */
    skipBranchCreation?: boolean;
    /**
     * When true, skip all worktree creation steps — the worktree was already
     * created by the caller (e.g. the POST handler) before fire-and-forget.
     */
    worktreeAlreadyCreated?: boolean;
    /**
     * When true, skip writing the initial_request event — the caller already
     * wrote it synchronously to the NDJSON file before fire-and-forget.
     */
    initialEventAlreadyWritten?: boolean;
  } = {},
): Promise<void> {

  try {
    // Step 1 — Create a new git worktree (on a fresh branch, or from an existing one)
    const worktreeLabel = options.skipBranchCreation
      ? `Checked out existing branch \`${session.branch}\``
      : `Created worktree \`${session.branch}\``;

    // Record the current branch so the preview instance can merge back into it.
    const parentBranchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
    const parentBranch = parentBranchResult.stdout.trim() || 'main';

    // When checking out an existing branch, detect if it's already registered in
    // a worktree (e.g. a previous session left the worktree behind). If so,
    // reuse that worktree path instead of trying to add a new one — git would
    // reject the attempt with "already used by worktree at <path>".
    if (!options.worktreeAlreadyCreated) {
      if (options.skipBranchCreation) {
        const listResult = await runGit(['worktree', 'list', '--porcelain'], repoRoot);
        const existingPath = parseWorktreePathForBranch(listResult.stdout, session.branch);
        if (existingPath) {
          session.worktreePath = existingPath;
        } else {
          const wtResult = await runGit(
            ['worktree', 'add', session.worktreePath, session.branch],
            repoRoot,
          );
          if (wtResult.code !== 0) {
            throw new Error(`git worktree add failed:\n${wtResult.stderr}`);
          }
        }
      } else {
        const wtResult = await runGit(
          ['worktree', 'add', session.worktreePath, '-b', session.branch],
          repoRoot,
        );
        if (wtResult.code !== 0) {
          throw new Error(`git worktree add failed:\n${wtResult.stderr}`);
        }
      }
    }

    // Write setup events to the NDJSON file.
    // The initial_request event may already have been written synchronously by the
    // route handler (options.initialEventAlreadyWritten=true) to avoid a race window
    // between session creation and the async fire-and-forget.
    const ndjsonPath = getSessionNdjsonPath(session.worktreePath);
    if (!options.initialEventAlreadyWritten) {
      appendSessionEvent(ndjsonPath, { type: 'initial_request', request: taskRequest, attachments: attachmentPaths.map(p => path.basename(p)), ts: Date.now() });
    }
    appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: 'setup', label: 'Setup', ts: Date.now() });
    appendSessionEvent(ndjsonPath, { type: 'setup_step', label: worktreeLabel, done: true, ts: Date.now() });

    // Store parent branch and session ID in git config so the preview's manage
    // endpoint can find them when logging the accept/reject decision back to the
    // parent instance's SQLite database.
    await runGit(['config', `branch.${session.branch}.parent`, parentBranch], repoRoot);
    await runGit(['config', `branch.${session.branch}.sessionId`, session.id], repoRoot);

    // Assign an ephemeral port to this branch in git config (idempotent).
    // The port is stable for the lifetime of the branch and is reused if the
    // server restarts. Preview and production servers both use this port.
    session.port = getOrAssignBranchPort(session.branch, repoRoot);

    // Step 2 — Run bun install in the worktree.
    // Bun is fast enough that a full install is preferable to a shared symlink,
    // which can cause subtle dependency issues when the worktree diverges.
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('bun', ['install'], {
        cwd: session.worktreePath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      proc.on('close', (code) => {
        if (code === 0) {
          appendSessionEvent(ndjsonPath, { type: 'setup_step', label: '`bun install` complete', done: true, ts: Date.now() });
          resolve();
        } else {
          reject(new Error(`bun install failed with exit code ${code}`));
        }
      });
      proc.on('error', (err) => reject(new Error(`bun install spawn failed: ${err.message}`)));
    });

    // Step 3 — Copy the SQLite database into the worktree so each branch gets
    // its own isolated data snapshot — analogous to Neon's database branching.
    // We copy rather than symlink so changes in the preview don't affect the
    // main dev instance's auth/session data.
    const dbName = '.primordia-auth.db';
    const srcDb = path.join(repoRoot, dbName);
    const dstDb = path.join(session.worktreePath, dbName);
    if (fs.existsSync(srcDb) && !fs.existsSync(dstDb)) {
      // Use VACUUM INTO to create a clean, consistent snapshot of the live DB.
      // This is safe while the source is actively written to — it incorporates
      // any pending WAL data and produces a WAL-free destination file, so the
      // child worktree never sees a partial or corrupted database.
      try {
        const { Database } = await import('bun:sqlite');
        const srcDbHandle = new Database(srcDb);
        try {
          srcDbHandle.prepare('VACUUM INTO ?').run(dstDb);
        } finally {
          srcDbHandle.close();
        }
      } catch {
        // Non-fatal — the child worktree will just have a stale partial session.
      }

      appendSessionEvent(ndjsonPath, { type: 'setup_step', label: `Copied \`${dbName}\` (isolated data branch)`, done: true, ts: Date.now() });
    }

    // Step 4 — Symlink .env.local so the preview server has the same credentials.
    // Resolve any symlink chain on srcEnv before linking, so the session worktree
    // points directly at the real file rather than through an intermediate symlink
    // (e.g. current/.env.local → main/.env.local). Intermediate symlinks can be
    // deleted when slots are cleaned up after an accept, which would leave a
    // dangling chain.
    const srcEnv = path.join(repoRoot, '.env.local');
    const dstEnv = path.join(session.worktreePath, '.env.local');
    if (fs.existsSync(srcEnv) && !fs.existsSync(dstEnv)) {
      const resolvedEnv = fs.realpathSync(srcEnv);
      fs.symlinkSync(resolvedEnv, dstEnv);
      appendSessionEvent(ndjsonPath, { type: 'setup_step', label: 'Symlinked `.env.local`', done: true, ts: Date.now() });
    }

    // Step 5 — Copy user-uploaded attachments into the worktree
    const worktreeAttachmentPaths: string[] = [];
    if (attachmentPaths.length > 0) {
      const attachmentsDir = path.join(session.worktreePath, 'attachments');
      fs.mkdirSync(attachmentsDir, { recursive: true });
      for (const srcPath of attachmentPaths) {
        const filename = path.basename(srcPath);
        const dstPath = path.join(attachmentsDir, filename);
        fs.copyFileSync(srcPath, dstPath);
        worktreeAttachmentPaths.push(`attachments/${filename}`);
      }
      // Clean up temp files and their directory
      for (const srcPath of attachmentPaths) {
        try { fs.unlinkSync(srcPath); } catch { /* non-fatal */ }
      }
      try { fs.rmdirSync(path.dirname(attachmentPaths[0])); } catch { /* non-fatal */ }
      appendSessionEvent(ndjsonPath, { type: 'setup_step', label: `Copied ${worktreeAttachmentPaths.length} attachment(s) into worktree`, done: true, ts: Date.now() });
    }

    // Step 6 — Spawn Claude Code as a detached worker process.
    // The worker writes progress to the NDJSON file. Status is inferred from the
    // 'result' event it writes on completion.
    // It survives server restarts — on next startup, reconnectRunningWorkers() re-attaches.
    session.status = 'running-claude';
    appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: 'claude', label: '🤖 Claude Code', ts: Date.now() });

    const attachmentSection = worktreeAttachmentPaths.length > 0
      ? `\n\nThe user has attached the following file(s) to this request (already saved in the worktree):\n` +
        worktreeAttachmentPaths.map(p => `- \`${p}\``).join('\n') +
        `\n\nRead and use these files as needed. If they are images or assets that should be added to the project, copy them to an appropriate location (e.g., \`public/\`) with a descriptive filename.`
      : '';

    const prompt =
      `Implement the following change:\n\n` +
      `${taskRequest}${attachmentSection}\n\n` +
      `After making changes:\n` +
      `1. Create a new changelog file in the \`changelog/\` directory named \`YYYY-MM-DD-HH-MM-SS Description of change.md\` (UTC time, e.g. \`2026-03-16-21-00-00 Fix login bug.md\`). The filename is the short description; the file body is the full "what changed + why" detail in markdown. Do NOT add changelog entries to CLAUDE.md itself.\n` +
      `2. Commit all changes with a descriptive message.`;

    await spawnClaudeWorker(
      {
        sessionId: session.id,
        worktreePath: session.worktreePath,
        repoRoot,
        prompt,
        timeoutMs: 20 * 60 * 1000,
      },
      path.join(repoRoot, 'scripts/claude-worker.ts'),
    );
    // Worker has exited — 'result' event in the NDJSON log marks completion.

  } catch (err) {
    // Write error event to NDJSON (makes inferStatusFromEvents return 'ready').
    const msg = err instanceof Error ? err.message : String(err);
    const ndjsonPath = getSessionNdjsonPath(session.worktreePath);
    if (fs.existsSync(ndjsonPath)) {
      appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'error', message: msg, ts: Date.now() });
    }
  }
}

// ─── Follow-up request ────────────────────────────────────────────────────────

/**
 * Runs a follow-up Claude Code pass inside an existing worktree.
 * The dev server keeps running; this function only re-invokes Claude and
 * persists the result. Status transitions: ready → running-claude → ready | error.
 *
 * @param onSuccess - Optional callback invoked when Claude finishes successfully.
 *   Used by the type-fix flow to retry Accept server-side without requiring the client tab to be open.
 * @param skipChangelog - When true, instructs Claude NOT to create or update changelog files.
 *   Use for automated fix passes (e.g. type-fix) that are part of the merge pipeline, not
 *   user-visible changes.
 */
export async function runFollowupInWorktree(
  session: LocalSession,
  followupRequest: string,
  repoRoot: string,
  /** Status used locally while Claude is running. Defaults to 'running-claude'. */
  inProgressStatus: LocalSessionStatus = 'running-claude',
  onSuccess?: (session: LocalSession) => Promise<void>,
  skipChangelog: boolean = false,
  /** Temporary file paths for user-uploaded attachments. Copied into worktree/attachments/ and deleted from /tmp. */
  attachmentPaths: string[] = [],
): Promise<void> {
  const ndjsonPath = getSessionNdjsonPath(session.worktreePath);

  try {
    if (skipChangelog) {
      // Type-fix passes get their own section heading instead of the user-facing follow-up format.
      appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: 'type_fix', label: '🔧 Fixing type errors…', ts: Date.now() });
    } else {
      appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: 'followup', label: '🔄 Follow-up Request', ts: Date.now() });
      appendSessionEvent(ndjsonPath, { type: 'followup_request', request: followupRequest, attachments: attachmentPaths.map(p => path.basename(p)), ts: Date.now() });
      appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: 'claude', label: '🤖 Claude Code', ts: Date.now() });
    }
    session.status = inProgressStatus;

    const changelogInstruction = skipChangelog
      ? `Do NOT create or update any changelog file — this fix is part of the automated merge pipeline, not a user-visible change.`
      : `This is a follow-up to changes already made on branch \`${session.branch}\`. Do NOT create a new changelog file. Instead, find the most recent changelog file in \`changelog/\` and update it if your changes invalidate or extend the existing description.`;

    // Copy user-uploaded attachments into the worktree
    const worktreeAttachmentPaths: string[] = [];
    if (attachmentPaths.length > 0) {
      const attachmentsDir = path.join(session.worktreePath, 'attachments');
      fs.mkdirSync(attachmentsDir, { recursive: true });
      for (const srcPath of attachmentPaths) {
        const filename = path.basename(srcPath);
        const dstPath = path.join(attachmentsDir, filename);
        fs.copyFileSync(srcPath, dstPath);
        worktreeAttachmentPaths.push(`attachments/${filename}`);
      }
      // Clean up temp files and their directory
      for (const srcPath of attachmentPaths) {
        try { fs.unlinkSync(srcPath); } catch { /* non-fatal */ }
      }
      try { fs.rmdirSync(path.dirname(attachmentPaths[0])); } catch { /* non-fatal */ }
    }

    const attachmentSection = worktreeAttachmentPaths.length > 0
      ? `\n\nThe user has attached the following file(s) to this request (already saved in the worktree):\n` +
        worktreeAttachmentPaths.map(p => `- \`${p}\``).join('\n') +
        `\n\nRead and use these files as needed. If they are images or assets that should be added to the project, copy them to an appropriate location (e.g., \`public/\`) with a descriptive filename.`
      : '';

    // With `continue: true`, Claude Code resumes the existing session in this
    // worktree and already has full context (original request, prior follow-ups,
    // everything it did). No need to manually reconstruct session history.
    const prompt =
      `Address the following follow-up request:\n\n` +
      `${followupRequest}${attachmentSection}\n\n` +
      `${changelogInstruction} Commit all changes with a descriptive message.`;

    // Spawn a detached worker process — same pattern as startLocalEvolve.
    // useContinue resumes the most recent Claude Code session in the worktree
    // so Claude has full conversation history without us re-injecting it.
    await spawnClaudeWorker(
      {
        sessionId: session.id,
        worktreePath: session.worktreePath,
        repoRoot,
        prompt,
        timeoutMs: 20 * 60 * 1000,
        useContinue: true,
      },
      path.join(repoRoot, 'scripts/claude-worker.ts'),
    );

    if (onSuccess) {
      // Only call onSuccess if the worker succeeded — check the last result event.
      // If the worker failed (error/timeout/abort), the result event's subtype will
      // not be 'success' and the session is already in a terminal state.
      const { events } = readSessionEvents(ndjsonPath);
      const lastResult = [...events].reverse().find(e => e.type === 'result') as
        Extract<SessionEvent, { type: 'result' }> | undefined;
      if (lastResult?.subtype === 'success') {
        await onSuccess(session);
      }
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (fs.existsSync(ndjsonPath)) {
      appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'error', message: msg, ts: Date.now() });
    }
  }
}

// ─── Restart dev server ───────────────────────────────────────────────────────

/**
 * Asks the reverse proxy to restart the preview server for a session.
 * The proxy manages the dev server process; this is a thin HTTP call to its
 * management API at /_proxy/preview/{sessionId}/restart.
 *
 * Kept for backward compatibility with kill-restart/route.ts.
 */
export async function restartDevServerInWorktree(
  session: LocalSession,
  _repoRoot: string,
  _publicHostname: string = "localhost",
): Promise<void> {
  const proxyPort = process.env.REVERSE_PROXY_PORT!;
  const res = await fetch(
    `http://127.0.0.1:${proxyPort}/_proxy/preview/${session.id}/restart`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Proxy restart failed (${res.status}): ${body}`);
  }
}

// ─── Auto conflict resolution ─────────────────────────────────────────────────

/**
 * When `git merge` leaves the repo in a conflicted state, run Claude Code
 * inside `mergeRoot` to resolve all conflicts and complete the merge commit.
 *
 * Returns { success: true } when Claude committed the resolved merge, or
 * { success: false, log } with a human-readable explanation when it could not.
 */
export async function resolveConflictsWithClaude(
  mergeRoot: string,
  branch: string,
  parentBranch: string,
): Promise<{ success: boolean; log: string }> {
  let log = '';

  const prompt =
    `A \`git merge ${branch}\` into \`${parentBranch}\` has produced merge conflicts ` +
    `in the repository at \`${mergeRoot}\`.\n\n` +
    `Please resolve all conflicts and complete the merge:\n` +
    `1. Run \`git status\` to identify every conflicted file.\n` +
    `2. Read each conflicted file, resolve the conflict markers by intelligently ` +
    `combining both sides, and write the resolved content back.\n` +
    `3. Stage each resolved file with \`git add <file>\`.\n` +
    `4. Finish the merge with \`git commit --no-edit\`.\n\n` +
    `Work only inside \`${mergeRoot}\`. Do not touch any files outside that directory.`;

  try {
    const run = query({
      prompt,
      options: {
        cwd: mergeRoot,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `The current working directory is: ${mergeRoot}`,
        },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    });

    for await (const message of run) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            // If the previous content ended a list (single trailing newline), add
            // a blank line so the list renders correctly in markdown.
            if (log.endsWith('\n') && !log.endsWith('\n\n')) {
              log += '\n';
            }
            log += block.text.trimEnd() + '\n\n';
          } else if (block.type === 'tool_use') {
            log += `- 🔧 ${block.name}\n`;
          }
        }
      } else if (message.type === 'result') {
        if (message.subtype !== 'success') {
          return {
            success: false,
            log: log + `\nClaude Code ended with subtype: ${message.subtype}`,
          };
        }
      }
    }

    // Verify the merge was committed: MERGE_HEAD must no longer exist.
    const mergeHeadResult = await runGit(['rev-parse', '--verify', 'MERGE_HEAD'], mergeRoot);
    if (mergeHeadResult.code === 0) {
      return {
        success: false,
        log:
          log +
          '\nMerge was not committed: MERGE_HEAD still exists after conflict resolution attempt.',
      };
    }

    return { success: true, log };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, log: log + `\nError during conflict resolution: ${msg}` };
  }
}

