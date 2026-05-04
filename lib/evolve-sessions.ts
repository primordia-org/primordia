// lib/evolve-sessions.ts
// Helpers for the local evolve flow.
// Only used when NODE_ENV=development.

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  appendSessionEvent,
  readSessionEvents,
  getSessionNdjsonPath,
  listSessionsFromFilesystem,
  type SessionEvent,
  type AgentAuthInfo,
} from './session-events';
import { HARNESS_OPTIONS, DEFAULT_HARNESS, DEFAULT_MODEL } from './agent-config';
import { getModelLabel } from './pi-model-registry.server';

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
  /** Coding agent harness to use (e.g. 'claude-code'). Defaults to 'claude-code'. */
  harness?: string;
  /** Model ID to pass to the harness (e.g. 'claude-sonnet-4-6'). Harness default if omitted. */
  model?: string;
  /**
   * Decrypted Anthropic API key supplied by the user for this request.
   * Transient — never persisted to the NDJSON log or SQLite.
   * When set, the worker bypasses the exe.dev gateway and calls the
   * Anthropic API directly. When omitted, the gateway is used.
   */
  apiKey?: string;
  /**
   * Decrypted Claude Code credentials.json content supplied by the user.
   * Transient — never persisted to the NDJSON log or SQLite.
   * When set, the worker writes this JSON to CLAUDE_CONFIG_DIR/.credentials.json
   * before running Claude Code and deletes it immediately afterwards.
   */
  credentials?: string;
  /**
   * Primordia user ID of the person who initiated this session.
   * Used to set CLAUDE_CONFIG_DIR so each user's Claude configuration
   * (settings, tool approvals, conversation history) is isolated.
   */
  userId: string;
}

// ─── Repo / worktree path utilities ──────────────────────────────────────────

/**
 * Returns the shared git repo root (the bare repo or the .git common dir)
 * given any path inside a worktree. Git commands work correctly from this
 * path whether it is a bare repo (source.git) or a non-bare .git directory.
 */
export function getRepoRoot(worktreePath: string): string {
  const { execFileSync } = require('child_process') as typeof import('child_process');
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: worktreePath,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  return path.resolve(worktreePath, commonDir);
}

/**
 * Returns the directory where session worktrees are created.
 * Prefers PRIMORDIA_WORKTREES_DIR, falling back to a `worktrees/` sibling of
 * the git common dir (works for both bare-repo and non-bare layouts).
 */
export function getWorktreesDir(repoRoot: string): string {
  if (process.env.PRIMORDIA_WORKTREES_DIR) return process.env.PRIMORDIA_WORKTREES_DIR;
  return path.join(path.dirname(repoRoot), 'worktrees');
}

// ─── Branch port management ────────────────────────────────────────────────────

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
  /** Model ID to use for the agent run. Omit to use the harness default. */
  model?: string;
  /** When true, continue the most recent Claude Code session in the worktree directory. */
  useContinue?: boolean;
  /**
   * Decrypted Anthropic API key to pass to the worker via environment variable.
   * NOT written to the JSON config file on disk — only passed in the worker
   * process environment so it is never at rest in a temp file.
   */
  apiKey?: string;
  /**
   * Decrypted Claude Code credentials.json content to pass to the worker via
   * environment variable. NOT written to the JSON config file on disk.
   * The worker writes this to CLAUDE_CONFIG_DIR/.credentials.json, runs Claude
   * Code, then deletes the file in its cleanup step.
   */
  credentials?: string;
  /**
   * Primordia user ID. CLAUDE_CONFIG_DIR is pointed at a per-user directory
   * so each user's Claude config is isolated.
   * NOT written to the JSON config file — only used to derive the env var.
   */
  userId: string;
}

/**
 * Determine which auth source a session will use and return the corresponding
 * AgentAuthInfo. Credentials take priority over an API key; both override the
 * gateway. Enforcing a single source here means the section_start event and
 * the worker env always agree on which credential was used.
 *
 * Rules:
 *  - Claude Credentials (credentials.json) are only supported by the
 *    'claude-code' harness. Pi and other harnesses use the Anthropic API
 *    directly and cannot read a credentials.json file, so credentials are
 *    silently ignored for those harnesses.
 *  - If BOTH credentials and an API key are supplied and the harness supports
 *    credentials, credentials win and the API key is discarded.
 */
function resolveAgentAuth(
  credentials: string | undefined,
  apiKey: string | undefined,
  harnessId: string,
): { auth: AgentAuthInfo; resolvedCredentials: string | undefined; resolvedApiKey: string | undefined } {
  const credentialsSupported = harnessId === 'claude-code';
  if (credentials && credentialsSupported) {
    return {
      auth: { source: 'claude-credentials' },
      resolvedCredentials: credentials,
      resolvedApiKey: undefined, // API key superseded
    };
  }
  if (apiKey) {
    return {
      auth: { source: 'api-key' },
      resolvedCredentials: undefined,
      resolvedApiKey: apiKey,
    };
  }
  return {
    auth: { source: 'llm-gateway' },
    resolvedCredentials: undefined,
    resolvedApiKey: undefined,
  };
}

/** Maps session IDs to the PID of their running agent worker process. */
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
 * Spawns a detached agent worker process for the given config.
 * The worker process is independent of the server — it survives server
 * restarts. Awaiting this function waits for the worker to exit.
 *
 * If the server exits while this is awaited, the worker keeps running.
 * On server restart, reconnectRunningWorkers() re-attaches to live workers.
 */
async function spawnAgentWorker(
  config: WorkerConfig,
  workerScriptPath: string,
): Promise<void> {
  checkWorktreeNotBusy(config.worktreePath);

  // Strip sensitive fields (API key, credentials) from the JSON config file so
  // they are never written to disk in plaintext. Pass them instead as process
  // environment variables. The worker reads and immediately deletes each var.
  const { apiKey: workerApiKey, credentials: workerCredentials, ...configWithoutSensitive } = config;
  const configFile = `/tmp/primordia-worker-${config.sessionId}.json`;
  fs.writeFileSync(configFile, JSON.stringify(configWithoutSensitive), 'utf8');

  // Build the worker's environment: inherit server env, then optionally inject
  // the user's API key and/or credentials.
  const workerEnv: NodeJS.ProcessEnv = { ...process.env };
  if (workerApiKey) {
    workerEnv['PRIMORDIA_USER_API_KEY'] = workerApiKey;
  }
  if (workerCredentials) {
    workerEnv['PRIMORDIA_USER_CREDENTIALS'] = workerCredentials;
  }
  const homeDir = process.env.HOME ?? '/home/exedev';
  workerEnv['CLAUDE_CONFIG_DIR'] = path.join(homeDir, '.claude-users', config.userId);

  return new Promise<void>((resolve, reject) => {
    const proc = spawn('bun', ['run', workerScriptPath, configFile], {
      cwd: config.repoRoot,
      detached: true,
      env: workerEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!proc.pid) {
      fs.rmSync(configFile, { force: true });
      reject(new Error('Failed to spawn agent worker: no PID assigned'));
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
      reject(new Error(`Agent worker spawn failed: ${err.message}`));
    });
  });
}

/**
 * On server startup: reconnect to any agent worker processes that survived
 * from before the restart. For each session in a running state:
 *   - If the worker's PID file exists and the process is alive, register its
 *     PID so abortAgentRun() can still send SIGTERM to it.
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

    // Worker is still running — register it so abortAgentRun() works.
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
 * Signals the running agent worker for the given session to stop.
 * Returns true if a live worker was found and signalled, false if the
 * session has no registered worker PID.
 */
export function abortAgentRun(sessionId: string): boolean {
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

export function runCommand(
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

// ─── Background Turbopack cache warming ─────────────────────────────────────

/**
 * Spawns `bun run build` in the given worktree at the lowest possible CPU and
 * I/O priority so Turbopack can warm its persistent file-system cache
 * (.next/cache/turbopack/) in the background while the user reviews the preview.
 *
 * By the time the user clicks Accept the cache is already warm, meaning the
 * mandatory build gate completes much faster.
 *
 * The process is fully detached (stdio: 'ignore', detached: true) so it never
 * blocks the main session pipeline or the Node/Bun event loop.
 *
 * `ionice -c 3` (idle I/O class) is attempted via the shell `||` operator so
 * that the build still runs on kernels / systems that don't support ionice.
 */
function spawnCacheWarmBuild(worktreePath: string): void {
  // Use `sh -c` so we can compose nice + ionice without requiring ionice to exist.
  // `ionice -c 3 ...` sets idle I/O priority; `|| ...` is the fallback when ionice
  // is unavailable (e.g. macOS, older kernels, or missing capability).
  const cmd = 'ionice -c 3 bun run --bun next build || bun run --bun next build';
  const proc = spawn('nice', ['-n', '19', 'sh', '-c', cmd], {
    cwd: worktreePath,
    stdio: 'ignore',
    detached: true,
    env: {
      ...process.env,
      // Ensure the build uses the same base path the dev server uses so the
      // Turbopack cache entries are compatible with the Accept build.
      NEXT_BASE_PATH: process.env.NEXT_BASE_PATH ?? '',
    },
  });
  proc.unref();
  console.log(`[evolve] cache-warming build started in ${worktreePath} (PID ${proc.pid ?? 'unknown'})`);
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

    // Store parent branch in git config so the manage endpoint can find it
    // when logging the accept/reject decision back to the parent instance.
    await runGit(['config', `branch.${session.branch}.parent`, parentBranch], repoRoot);

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
      // Collect existing filenames to avoid overwriting previous attachments
      const usedNames = new Set<string>(
        fs.existsSync(attachmentsDir) ? fs.readdirSync(attachmentsDir) : []
      );
      for (const srcPath of attachmentPaths) {
        let filename = path.basename(srcPath);
        if (usedNames.has(filename)) {
          const ext = path.extname(filename);
          const stem = filename.slice(0, filename.length - ext.length);
          let counter = 1;
          while (usedNames.has(`${stem}_${counter}${ext}`)) counter++;
          filename = `${stem}_${counter}${ext}`;
        }
        usedNames.add(filename);
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

    // Step 6 — Spawn Claude Code as a detached worker process (or skip if no prompt).
    if (!taskRequest) {
      // No prompt — mark the session ready immediately so the preview can be
      // tested before any changes are made. Follow-up requests can still be submitted.
      appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'success', ts: Date.now() });
      return;
    }

    // The worker writes progress to the NDJSON file. Status is inferred from the
    // 'result' event it writes on completion.
    // It survives server restarts — on next startup, reconnectRunningWorkers() re-attaches.
    session.status = 'running-claude';
    const harnessId = session.harness ?? DEFAULT_HARNESS;
    const modelId = session.model ?? DEFAULT_MODEL;
    const harnessLabel = HARNESS_OPTIONS.find((h) => h.id === harnessId)?.label ?? harnessId;
    const modelLabel = getModelLabel(harnessId, modelId);
    // Resolve auth source — credentials beat API key; both beat the gateway.
    // This also enforces exclusivity so the worker never receives two sources.
    const { auth, resolvedApiKey, resolvedCredentials } = resolveAgentAuth(session.credentials, session.apiKey, harnessId);
    appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: 'agent', harness: harnessLabel, model: modelLabel, harnessId, modelId, auth, label: `🤖 ${harnessLabel} (${modelLabel})`, ts: Date.now() });

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
      `2. Commit all changes with a descriptive message.\n` +
      `3. In your final message, mention the path of the most relevant page to open in the preview, e.g. "The relevant page is at \`/api-docs\`." Skip this step only if all changes are purely server-side or no single page is more relevant than the landing page.`;

    const workerScript = (harnessId === 'pi')
      ? path.join(repoRoot, 'scripts/pi-worker.ts')
      : path.join(repoRoot, 'scripts/claude-worker.ts');

    await spawnAgentWorker(
      {
        sessionId: session.id,
        worktreePath: session.worktreePath,
        repoRoot,
        prompt,
        timeoutMs: 20 * 60 * 1000,
        // Use the resolved modelId so the worker always runs with the same
        // model that was logged in the section_start event.
        model: modelId,
        apiKey: resolvedApiKey,
        credentials: resolvedCredentials,
        userId: session.userId,
      },
      workerScript,
    );
    // Worker has exited — 'result' event in the NDJSON log marks completion.

    // Background cache-warming: run `bun run build` at the lowest CPU/IO
    // priority so Turbopack populates .next/cache/turbopack/ before the user
    // clicks Accept.  We attempt `ionice -c 3` (idle I/O class) first; if the
    // kernel doesn't support ionice it is silently ignored via the shell `||`.
    // The process is fully detached so it never blocks the main pipeline.
    void spawnCacheWarmBuild(session.worktreePath);

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
  /**
   * When set, this is an internal (non-user-visible) agent pass:
   * - The changelog instruction in the prompt is suppressed.
   * - A section_start with this sectionType is emitted instead of the normal
   *   followup/agent section pair.
   * Pass 'type_fix' for TypeScript auto-fix passes and 'auto_commit' for
   * Gate-2 unstaged-changes commit passes.
   */
  internalSectionType?: 'type_fix' | 'auto_commit',
  /** Temporary file paths for user-uploaded attachments. Copied into worktree/attachments/ and deleted from /tmp. */
  attachmentPaths: string[] = [],
): Promise<void> {
  const ndjsonPath = getSessionNdjsonPath(session.worktreePath);

  const fuHarnessId = session.harness ?? DEFAULT_HARNESS;
  // Resolve the model ID now so the section_start label and worker config are always consistent.
  // This also means the user's model choice for a follow-up always overrides the previous run's model.
  const fuModelId = session.model ?? DEFAULT_MODEL;

  try {
    if (internalSectionType) {
      const sectionLabels: Record<'type_fix' | 'auto_commit', string> = {
        type_fix: '🔧 Fixing type errors…',
        auto_commit: '📦 Committing unstaged changes…',
      };
      appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: internalSectionType, label: sectionLabels[internalSectionType], ts: Date.now() });
    } else {
      appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: 'followup', label: '🔄 Follow-up Request', ts: Date.now() });
      appendSessionEvent(ndjsonPath, { type: 'followup_request', request: followupRequest, attachments: attachmentPaths.map(p => path.basename(p)), ts: Date.now() });
      const fuHarnessLabel = HARNESS_OPTIONS.find((h) => h.id === fuHarnessId)?.label ?? fuHarnessId;
      const fuModelLabel = getModelLabel(fuHarnessId, fuModelId);
      // Resolve auth — credentials beat API key; both beat the gateway.
      const fuAuth = resolveAgentAuth(session.credentials, session.apiKey, fuHarnessId);
      appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: 'agent', harness: fuHarnessLabel, model: fuModelLabel, harnessId: fuHarnessId, modelId: fuModelId, auth: fuAuth.auth, label: `🤖 ${fuHarnessLabel} (${fuModelLabel})`, ts: Date.now() });
    }
    session.status = inProgressStatus;

    const changelogInstruction = !!internalSectionType
      ? `Do NOT create or update any changelog file — this fix is part of the automated merge pipeline, not a user-visible change.`
      : `This is a follow-up to changes already made on branch \`${session.branch}\`. Do NOT create a new changelog file. Instead, find the most recent changelog file in \`changelog/\` and update it if your changes invalidate or extend the existing description.`;

    // Copy user-uploaded attachments into the worktree
    const worktreeAttachmentPaths: string[] = [];
    if (attachmentPaths.length > 0) {
      const attachmentsDir = path.join(session.worktreePath, 'attachments');
      fs.mkdirSync(attachmentsDir, { recursive: true });
      // Collect existing filenames to avoid overwriting previous attachments
      const usedNames = new Set<string>(
        fs.existsSync(attachmentsDir) ? fs.readdirSync(attachmentsDir) : []
      );
      for (const srcPath of attachmentPaths) {
        let filename = path.basename(srcPath);
        if (usedNames.has(filename)) {
          const ext = path.extname(filename);
          const stem = filename.slice(0, filename.length - ext.length);
          let counter = 1;
          while (usedNames.has(`${stem}_${counter}${ext}`)) counter++;
          filename = `${stem}_${counter}${ext}`;
        }
        usedNames.add(filename);
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

    // With `useContinue: true` the harness resumes the most recent session in
    // this worktree so it has full conversation history without us having to
    // reconstruct it.  Both Claude Code and pi support resuming with a different
    // model, so the user's model choice always takes effect even when changing it
    // mid-session.  If the agent has no native memory of the worktree (e.g. the
    // harness was switched and useContinue falls back gracefully), it can read
    // .primordia-session.ndjson to reconstruct session history — see CLAUDE.md.
    const previewPathInstruction = internalSectionType
      ? ''
      : `\n\nIn your final message, mention the path of the most relevant page to open in the preview, e.g. "The relevant page is at \`/chat\`." Skip this only if all changes are purely server-side or no single page is more relevant than the landing page.`;

    const prompt =
      `Address the following follow-up request:\n\n` +
      `${followupRequest}${attachmentSection}\n\n` +
      `${changelogInstruction} Commit all changes with a descriptive message.${previewPathInstruction}`;

    const fuWorkerScript = (fuHarnessId === 'pi')
      ? path.join(repoRoot, 'scripts/pi-worker.ts')
      : path.join(repoRoot, 'scripts/claude-worker.ts');

    await spawnAgentWorker(
      {
        sessionId: session.id,
        worktreePath: session.worktreePath,
        repoRoot,
        prompt,
        timeoutMs: 20 * 60 * 1000,
        // Use the resolved fuModelId so the worker always runs with the same
        // model that was logged in the section_start event, and the user's
        // model choice overrides the previous run's model.
        model: fuModelId,
        useContinue: true,
        // Re-resolve auth to enforce exclusivity (credentials beat API key).
        // fuAuth may not be in scope when internalSectionType is set.
        ...(() => {
          const r = resolveAgentAuth(session.credentials, session.apiKey, fuHarnessId);
          return { apiKey: r.resolvedApiKey, credentials: r.resolvedCredentials };
        })(),
        userId: session.userId,
      },
      fuWorkerScript,
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
 * Progress is streamed to the session's NDJSON log as a `conflict_resolution`
 * section, so the user can see what the agent is doing in real time.
 *
 * Returns { success: true } when the agent committed the resolved merge, or
 * { success: false, log } with a human-readable explanation when it could not.
 */
export async function resolveConflictsWithAgent(
  mergeRoot: string,
  branch: string,
  parentBranch: string,
  sessionContext: { id: string; harness?: string; model?: string; apiKey?: string; credentials?: string; userId: string },
  repoRoot?: string,
): Promise<{ success: boolean; log: string }> {
  const root = repoRoot ?? process.cwd();
  const ndjsonPath = getSessionNdjsonPath(mergeRoot);

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

  // Write a section header so the conflict resolution run appears as a named
  // block in the session progress log.
  if (fs.existsSync(ndjsonPath)) {
    appendSessionEvent(ndjsonPath, {
      type: 'section_start',
      sectionType: 'conflict_resolution',
      label: '🔀 Resolving merge conflicts…',
      ts: Date.now(),
    });
  }

  const harnessId = sessionContext.harness ?? DEFAULT_HARNESS;
  const workerScript = (harnessId === 'pi')
    ? path.join(root, 'scripts/pi-worker.ts')
    : path.join(root, 'scripts/claude-worker.ts');

  try {
    await spawnAgentWorker(
      {
        sessionId: sessionContext.id,
        worktreePath: mergeRoot,
        repoRoot: root,
        prompt,
        timeoutMs: 10 * 60 * 1000,
        model: sessionContext.model,
        // Enforce auth exclusivity (credentials beat API key).
        ...(() => {
          // Conflict resolution always uses the claude-code harness (resolveConflictsWithAgent
          // picks the harness from sessionContext, defaulting to DEFAULT_HARNESS).
          const r = resolveAgentAuth(sessionContext.credentials, sessionContext.apiKey, harnessId);
          return { apiKey: r.resolvedApiKey, credentials: r.resolvedCredentials };
        })(),
        userId: sessionContext.userId,
      },
      workerScript,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, log: `Error spawning conflict resolution worker: ${msg}` };
  }

  // Read the result from the NDJSON log — the worker writes a 'result' event on exit.
  const { events } = readSessionEvents(ndjsonPath);
  const lastResult = [...events].reverse().find(
    (e): e is Extract<SessionEvent, { type: 'result' }> => e.type === 'result',
  );
  if (lastResult?.subtype !== 'success') {
    return {
      success: false,
      log: lastResult?.message ?? 'Conflict resolution worker did not report success.',
    };
  }

  // Verify the merge was actually committed: MERGE_HEAD must no longer exist.
  const mergeHeadResult = await runGit(['rev-parse', '--verify', 'MERGE_HEAD'], mergeRoot);
  if (mergeHeadResult.code === 0) {
    return {
      success: false,
      log: 'Merge was not committed: MERGE_HEAD still exists after conflict resolution attempt.',
    };
  }

  return { success: true, log: '' };
}

