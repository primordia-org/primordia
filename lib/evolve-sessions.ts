// lib/evolve-sessions.ts
// Helpers for the local evolve flow.
// Only used when NODE_ENV=development.

import { execFileSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { readBranchMarker, writeBranchMarker } from './branch-parent';
import {
  appendSessionEvent,
  readSessionEvents,
  getSessionNdjsonPath,
  listSessionsFromFilesystem,
  type SessionEvent,
  type AgentAuthInfo,
} from './session-events';
import { HARNESS_OPTIONS, DEFAULT_HARNESS, DEFAULT_MODEL } from './agent-config';
import { MODEL_OPTIONS } from './agent-config';

/** Look up the human-readable label for a model ID within a given harness. Falls back to the raw ID. */
function getModelLabel(harnessId: string, modelId: string): string {
  return MODEL_OPTIONS[harnessId]?.find((m) => m.id === modelId)?.label ?? modelId;
}

const MARKDOWN_SCREENSHOT_INSTRUCTION = `If you capture screenshots or create image files under the worktree's \`attachments/\` folder, you may include them in your final text output using Markdown image syntax like \`![description](attachments/screenshot.png)\`; put the image syntax on its own line/paragraph, not inside a list item or inline code span. The session page renders final text as Markdown and will display those images inline with a figure caption from the alt text.`;

const SET_PREVIEW_URL_INSTRUCTION = `As soon as you are done editing the app files, and before validation/typecheck/build work and before creating or editing the changelog, choose the most relevant preview page: run \`bun run set-preview-url /route\` (example: \`bun run set-preview-url /admin\`). Use \`/\` for the landing page. Do not provide a full URL or filesystem path. Skip this only if all changes are purely server-side or no single page is more relevant than the landing page.`;

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
   * Decrypted ChatGPT subscription OAuth credentials supplied by the user.
   * Transient — never persisted to the NDJSON log or SQLite. Used by the Pi
   * harness for `openai-codex:*` models via Pi's openai-codex OAuth provider.
   */
  chatGptOAuth?: string;
  /** Preset-selected billing/auth source. Used to prevent silent gateway fallback. */
  authSource?: string | null;
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
  /** Decrypted ChatGPT subscription OAuth credentials for Pi/Codex ChatGPT subscription models. */
  chatGptOAuth?: string;
  /** Preset-selected billing/auth source. Used to prevent silent gateway fallback. */
  authSource?: string | null;
  /**
   * Primordia user ID. CLAUDE_CONFIG_DIR is pointed at a per-user directory
   * so each user's Claude config is isolated.
   * NOT written to the JSON config file — only used to derive the env var.
   */
  userId: string;
}

/**
 * Determine which already-selected auth source a session will use and return
 * the corresponding AgentAuthInfo. Evolve presets are responsible for selecting
 * exactly one billing source before the worker is invoked; this function only
 * sanitizes incompatible fields so the section_start event and worker env agree.
 *
 * Rules:
 *  - Claude Credentials (credentials.json) are only supported by the
 *    'claude-code' harness. Pi and other harnesses use API/OAuth credentials
 *    directly and cannot read a credentials.json file.
 *  - If malformed input includes more than one credential, keep the first
 *    harness-compatible credential only as defensive deduplication. Product
 *    flows must not rely on this as credential selection logic.
 */
function resolveAgentAuth(
  credentials: string | undefined,
  apiKey: string | undefined,
  harnessId: string,
  chatGptOAuth?: string,
  modelId?: string,
  requestedAuthSource?: string | null,
): { auth: AgentAuthInfo; resolvedCredentials: string | undefined; resolvedApiKey: string | undefined; resolvedChatGptOAuth: string | undefined } {
  if (requestedAuthSource === 'chatgpt-subscription') {
    if (harnessId !== 'pi' && harnessId !== 'codex') {
      throw new Error('ChatGPT subscription auth is only supported by the Pi and Codex harnesses. Choose a ChatGPT-compatible preset.');
    }
    if (harnessId === 'pi' && !modelId?.startsWith('openai-codex:')) {
      throw new Error('ChatGPT subscription auth for Pi requires an openai-codex model. Choose a ChatGPT subscription model.');
    }
    if (!chatGptOAuth) {
      throw new Error('ChatGPT subscription was selected, but ChatGPT credentials were not provided. Reconnect ChatGPT in Settings → Billing sources, then try again.');
    }
    return {
      auth: { source: 'chatgpt-subscription' },
      resolvedCredentials: undefined,
      resolvedApiKey: undefined,
      resolvedChatGptOAuth: chatGptOAuth,
    };
  }

  const credentialsSupported = harnessId === 'claude-code';
  if (credentials && credentialsSupported) {
    return {
      auth: { source: 'claude-credentials' },
      resolvedCredentials: credentials,
      resolvedApiKey: undefined, // API key superseded
      resolvedChatGptOAuth: undefined,
    };
  }
  if (chatGptOAuth && (harnessId === 'codex' || (harnessId === 'pi' && modelId?.startsWith('openai-codex:')))) {
    return {
      auth: { source: 'chatgpt-subscription' },
      resolvedCredentials: undefined,
      resolvedApiKey: undefined,
      resolvedChatGptOAuth: chatGptOAuth,
    };
  }
  if (apiKey) {
    return {
      auth: { source: 'api-key' },
      resolvedCredentials: undefined,
      resolvedApiKey: apiKey,
      resolvedChatGptOAuth: undefined,
    };
  }
  return {
    auth: { source: 'llm-gateway' },
    resolvedCredentials: undefined,
    resolvedApiKey: undefined,
    resolvedChatGptOAuth: undefined,
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
  const { apiKey: workerApiKey, credentials: workerCredentials, chatGptOAuth: workerChatGptOAuth, ...configWithoutSensitive } = config;
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
  if (workerChatGptOAuth) {
    workerEnv['PRIMORDIA_CHATGPT_OAUTH'] = workerChatGptOAuth;
  }
  if (config.authSource) {
    workerEnv['PRIMORDIA_REQUIRED_AUTH_SOURCE'] = config.authSource;
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
export function abortAgentRun(sessionId: string, worktreePath?: string): boolean {
  let pid = activeWorkerPids.get(sessionId);

  // If the app server restarted before reconnectRunningWorkers() registered the
  // worker, fall back to the durable PID file written inside the worktree.
  if (pid === undefined && worktreePath) {
    const pidFile = path.join(worktreePath, '.primordia-worker.pid');
    if (fs.existsSync(pidFile)) {
      const parsed = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (!isNaN(parsed) && isProcessAlive(parsed)) {
        pid = parsed;
        activeWorkerPids.set(sessionId, pid);
      }
    }
  }

  if (pid === undefined) return false;

  let signalled = false;
  try {
    // Workers are spawned detached, so their PID is also their process-group ID.
    // Signal the whole group first so any subprocesses/tools are asked to stop,
    // then signal the worker PID directly as a fallback for platforms that do
    // not support negative PIDs.
    try { process.kill(-pid, 'SIGTERM'); signalled = true; } catch { /* fallback below */ }
    try { process.kill(pid, 'SIGTERM'); signalled = true; } catch { /* may already be gone */ }
  } catch {
    // Worker may have already exited.
  }

  if (!signalled) {
    activeWorkerPids.delete(sessionId);
    return false;
  }

  // Last-resort cleanup: if the worker ignores graceful abort, kill the group
  // after a short grace period. Do not await this from the request handler.
  setTimeout(() => {
    if (!isProcessAlive(pid!)) {
      activeWorkerPids.delete(sessionId);
      return;
    }
    try { process.kill(-pid!, 'SIGKILL'); } catch { /* best-effort */ }
    try { process.kill(pid!, 'SIGKILL'); } catch { /* best-effort */ }
    activeWorkerPids.delete(sessionId);
  }, 10_000).unref?.();

  return true;
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

async function trustMiseConfig(worktreePath: string): Promise<boolean> {
  const miseConfigPath = path.join(worktreePath, 'mise.toml');
  if (!fs.existsSync(miseConfigPath)) return false;

  const trustResult = await runCommand('mise', ['trust', miseConfigPath], worktreePath);
  if (trustResult.code !== 0) {
    throw new Error(`mise trust failed:\n${trustResult.stderr || trustResult.stdout}`);
  }

  return true;
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

export interface CopyProductionDbResult {
  copied: boolean;
  sourcePath: string | null;
  destinationPath: string;
  error?: string;
}

async function vacuumSnapshotSqliteDb(sourcePath: string, snapshotPath: string): Promise<void> {
  try { fs.unlinkSync(snapshotPath); } catch { /* absent */ }
  try {
    const { Database } = await import('bun:sqlite');
    const srcDbHandle = new Database(sourcePath);
    try {
      srcDbHandle.prepare('VACUUM INTO ?').run(snapshotPath);
    } finally {
      srcDbHandle.close();
    }
  } catch (err) {
    try { fs.unlinkSync(snapshotPath); } catch { /* absent */ }
    throw err;
  }
}

function replaceSqliteDbWithSnapshot(snapshotPath: string, destinationPath: string): void {
  // Remove WAL sidecars before swapping the main DB file so the destination
  // worktree opens a clean, self-contained snapshot from production.
  for (const sidecar of [destinationPath, `${destinationPath}-wal`, `${destinationPath}-shm`]) {
    try { fs.unlinkSync(sidecar); } catch { /* absent or in use: best effort */ }
  }
  fs.renameSync(snapshotPath, destinationPath);
}

async function vacuumCopySqliteDb(sourcePath: string, destinationPath: string): Promise<void> {
  const tempDestination = `${destinationPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await vacuumSnapshotSqliteDb(sourcePath, tempDestination);
    replaceSqliteDbWithSnapshot(tempDestination, destinationPath);
  } catch (err) {
    try { fs.unlinkSync(tempDestination); } catch { /* absent */ }
    throw err;
  }
}

async function findProductionDbPath(repoRoot: string, dbName: string): Promise<string | null> {
  const productionBranchResult = await runGit(['config', '--get', 'primordia.productionBranch'], repoRoot);
  const productionBranch = productionBranchResult.stdout.trim();
  if (productionBranch) {
    const worktreeList = await runGit(['worktree', 'list', '--porcelain'], repoRoot);
    const productionWorktreePath = parseWorktreePathForBranch(worktreeList.stdout, productionBranch);
    if (productionWorktreePath) {
      const candidate = path.join(productionWorktreePath, dbName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // In local development, or before primordia.productionBranch has been set,
  // the server's current working directory is the best available prod source.
  const candidate = path.join(repoRoot, dbName);
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

/**
 * Copy the current production SQLite DB into a session worktree using
 * `VACUUM INTO`, producing a consistent, WAL-free snapshot even while prod is
 * actively writing. Used when creating a session and when Apply Updates brings
 * an existing local branch up to date with production code.
 */
export async function copyProductionDbToWorktree(
  repoRoot: string,
  destinationWorktreePath: string,
): Promise<CopyProductionDbResult> {
  const dbName = '.primordia-auth.db';
  const destinationPath = path.join(destinationWorktreePath, dbName);
  const sourcePath = await findProductionDbPath(repoRoot, dbName);

  if (!sourcePath) {
    return { copied: false, sourcePath: null, destinationPath, error: 'production DB not found' };
  }

  try {
    if (fs.existsSync(destinationPath) && fs.realpathSync(sourcePath) === fs.realpathSync(destinationPath)) {
      return { copied: false, sourcePath, destinationPath, error: 'source and destination DB are the same file' };
    }
  } catch { /* realpath can fail if either path disappears; continue and let copy report the error */ }

  try {
    await vacuumCopySqliteDb(sourcePath, destinationPath);
    return { copied: true, sourcePath, destinationPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { copied: false, sourcePath, destinationPath, error: message };
  }
}

export async function hotswapProductionDbIntoWorktree(
  repoRoot: string,
  destinationWorktreePath: string,
  devServerPort: number | null | undefined,
): Promise<CopyProductionDbResult> {
  const dbName = '.primordia-auth.db';
  const destinationPath = path.join(destinationWorktreePath, dbName);
  const sourcePath = await findProductionDbPath(repoRoot, dbName);

  if (!sourcePath) {
    return { copied: false, sourcePath: null, destinationPath, error: 'production DB not found' };
  }

  try {
    if (fs.existsSync(destinationPath) && fs.realpathSync(sourcePath) === fs.realpathSync(destinationPath)) {
      return { copied: false, sourcePath, destinationPath, error: 'source and destination DB are the same file' };
    }
  } catch { /* continue */ }

  const snapshotFilename = `${dbName}.hotswap-${process.pid}-${Date.now()}`;
  const snapshotPath = path.join(destinationWorktreePath, snapshotFilename);
  try {
    await vacuumSnapshotSqliteDb(sourcePath, snapshotPath);

    if (devServerPort) {
      try {
        const response = await fetch(`http://127.0.0.1:${devServerPort}/api/evolve/hotswap-db`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ snapshotFilename }),
        });
        if (response.ok) {
          return { copied: true, sourcePath, destinationPath };
        }
        const text = await response.text().catch(() => '');
        throw new Error(`preview server hotswap failed (${response.status}): ${text}`);
      } catch (err) {
        // If the preview server is not running, no process has the DB open and
        // a direct swap is safe. Any other response means the server was alive
        // but could not close its DB cleanly, so do not overwrite underneath it.
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('fetch failed') && !message.includes('ECONNREFUSED')) {
          throw err;
        }
      }
    }

    replaceSqliteDbWithSnapshot(snapshotPath, destinationPath);
    return { copied: true, sourcePath, destinationPath };
  } catch (err) {
    try { fs.unlinkSync(snapshotPath); } catch { /* already consumed */ }
    const message = err instanceof Error ? err.message : String(err);
    return { copied: false, sourcePath, destinationPath, error: message };
  }
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
  // Write the PID to a well-known file so accept can kill the warmup
  // build before running its own `bun run build` — Next.js refuses to start
  // a second build if one is already in progress.
  if (proc.pid !== undefined) {
    const pidFile = path.join(worktreePath, '.primordia-warmup-build.pid');
    try { fs.writeFileSync(pidFile, String(proc.pid)); } catch { /* non-fatal */ }
  }
  console.log(`[evolve] cache-warming build started in ${worktreePath} (PID ${proc.pid ?? 'unknown'})`);
}

// ─── Main flow ────────────────────────────────────────────────────────────────

export async function startLocalEvolve(
  session: LocalSession,
  taskRequest: string,
  repoRoot: string,
  /** @deprecated No longer used — preview URLs are derived from the session ID. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    const parentShaResult = await runGit(['rev-parse', parentBranch], repoRoot);
    const parentSha = parentShaResult.stdout.trim();

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

    if (await trustMiseConfig(session.worktreePath)) {
      appendSessionEvent(ndjsonPath, { type: 'setup_step', label: '`mise trust` complete', done: true, ts: Date.now() });
    }

    // Keep the legacy git-config parent metadata for new branches while also
    // writing branch-marker commits. The branch may already have been created
    // synchronously by the route handler so the session page can load
    // immediately; it still needs the marker commit in that case.
    if (!options.skipBranchCreation) {
      await runGit(['config', `branch.${session.branch}.parent`, parentBranch], repoRoot);

      // Write an empty "branch marker" commit to record parentage so it travels
      // with the branch through clones. Avoid duplicating it if a retry resumes
      // after the marker has already been written.
      if (parentSha && !readBranchMarker(session.branch, repoRoot)) {
        writeBranchMarker(session.worktreePath, parentBranch, parentSha);
      }
    }

    // Assign an ephemeral port to this branch in git config (idempotent).
    // The port is stable for the lifetime of the branch and is reused if the
    // server restarts. Preview and production servers both use this port.
    session.port = getOrAssignBranchPort(session.branch, repoRoot);

    // Step 2 — Run bun install in the worktree.
    // Bun is fast enough that a full install is preferable to a shared symlink,
    // which can cause subtle dependency issues when the worktree diverges.
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('mise', ['exec', '-C', session.worktreePath, '--', 'bun', 'install'], {
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
    // production instance's auth/session data.
    const dbName = '.primordia-auth.db';
    if (!fs.existsSync(path.join(session.worktreePath, dbName))) {
      const dbCopy = await copyProductionDbToWorktree(repoRoot, session.worktreePath);
      if (dbCopy.copied) {
        appendSessionEvent(ndjsonPath, { type: 'setup_step', label: `Copied \`${dbName}\` (isolated data branch)`, done: true, ts: Date.now() });
      }
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
    const { auth, resolvedApiKey, resolvedCredentials, resolvedChatGptOAuth } = resolveAgentAuth(session.credentials, session.apiKey, harnessId, session.chatGptOAuth, modelId, session.authSource);
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
      `1. ${SET_PREVIEW_URL_INSTRUCTION}\n` +
      `2. Create a new changelog file in the \`changelog/\` directory named \`YYYY-MM-DD-HH-MM-SS Description of change.md\` (UTC time, e.g. \`2026-03-16-21-00-00 Fix login bug.md\`). The filename is the short description; the file body is the full "what changed + why" detail in markdown. Do NOT add changelog entries to CLAUDE.md itself.\n` +
      `3. Commit all changes with a descriptive message.\n` +
      `4. ${MARKDOWN_SCREENSHOT_INSTRUCTION}`;

    const workerScript = harnessId === 'pi'
      ? path.join(repoRoot, 'scripts/pi-worker.ts')
      : harnessId === 'codex'
        ? path.join(repoRoot, 'scripts/codex-worker.ts')
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
        chatGptOAuth: resolvedChatGptOAuth,
        authSource: session.authSource,
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
  requestMetadata: { presetId?: string; authSource?: string; harness?: string; model?: string } = {},
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
      appendSessionEvent(ndjsonPath, {
        type: 'followup_request',
        request: followupRequest,
        attachments: attachmentPaths.map(p => path.basename(p)),
        ...requestMetadata,
        ts: Date.now(),
      });
      const fuHarnessLabel = HARNESS_OPTIONS.find((h) => h.id === fuHarnessId)?.label ?? fuHarnessId;
      const fuModelLabel = getModelLabel(fuHarnessId, fuModelId);
      // Resolve auth — credentials beat API key; both beat the gateway.
      const fuAuth = resolveAgentAuth(session.credentials, session.apiKey, fuHarnessId, session.chatGptOAuth, fuModelId, session.authSource);
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
      : `\n\n${SET_PREVIEW_URL_INSTRUCTION}\n\n${MARKDOWN_SCREENSHOT_INSTRUCTION}`;

    const prompt =
      `Address the following follow-up request:\n\n` +
      `${followupRequest}${attachmentSection}\n\n` +
      `${previewPathInstruction}\n\n${changelogInstruction} Commit all changes with a descriptive message.`;

    const fuWorkerScript = fuHarnessId === 'pi'
      ? path.join(repoRoot, 'scripts/pi-worker.ts')
      : fuHarnessId === 'codex'
        ? path.join(repoRoot, 'scripts/codex-worker.ts')
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
          const r = resolveAgentAuth(session.credentials, session.apiKey, fuHarnessId, session.chatGptOAuth, fuModelId, session.authSource);
          return { apiKey: r.resolvedApiKey, credentials: r.resolvedCredentials, chatGptOAuth: r.resolvedChatGptOAuth };
        })(),
        authSource: session.authSource,
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  sessionContext: { id: string; harness?: string; model?: string; apiKey?: string; credentials?: string; chatGptOAuth?: string; authSource?: string | null; userId: string },
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
  const workerScript = harnessId === 'pi'
    ? path.join(root, 'scripts/pi-worker.ts')
    : harnessId === 'codex'
      ? path.join(root, 'scripts/codex-worker.ts')
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
          const r = resolveAgentAuth(sessionContext.credentials, sessionContext.apiKey, harnessId, sessionContext.chatGptOAuth, sessionContext.model, sessionContext.authSource);
          return { apiKey: r.resolvedApiKey, credentials: r.resolvedCredentials, chatGptOAuth: r.resolvedChatGptOAuth };
        })(),
        authSource: sessionContext.authSource,
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
