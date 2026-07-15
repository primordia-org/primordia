// lib/threads.ts
// Shared thread creation, follow-up, worktree orchestration, workers, previews, and accept/reject helpers.

import { execFileSync, spawn } from 'child_process';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { complete, type UserMessage } from '@earendil-works/pi-ai';
import * as path from 'path';
import * as fs from 'fs';
import { getParentBranch, readBranchMarker, writeBranchMarker } from './branch-parent';
import {
  appendSessionEvent,
  readSessionEvents,
  getSessionNdjsonPath,
  getSessionFromFilesystem,
  listSessionsFromFilesystem,
  type SessionEvent,
  type AgentAuthInfo,
} from './session-events';
import { HARNESS_OPTIONS, DEFAULT_HARNESS, DEFAULT_MODEL } from './agent-config';
import { MODEL_OPTIONS } from './agent-config';
import { withSocketStatusHint } from './socket-status';
import { getProcessStatusReport, restartWorktreeServer, stopWorktreeServer } from './process-manager';
import { hasEvolvePermission } from './auth';
import { progressSummary, reduceProgressEventsAcrossRuns, type ProgressStateStep } from './progress-monitor';
import { decryptStoredSecretForUser, getEncryptedSecretForUser } from './server-secrets';
import { getDb } from './db';
import { PREF_HARNESS, PREF_MODEL, PREF_CAVEMAN, PREF_CAVEMAN_INTENSITY, DEFAULT_CAVEMAN_INTENSITY, getBranchParentSource, type CavemanIntensity } from './user-prefs';
import { BUILT_IN_PRESETS, PREF_CUSTOM_PRESETS, PREF_PRESET, normalizeAuthSource, parseCustomPresets, type EvolvePreset, type PresetAuthSource, type SecretAuthSource } from './presets';
import { ensurePrimordiaPiModelsJson } from './pi-custom-models';
import {
  copyProductionDbToWorktree,
  findProductionDbPath,
  replaceSqliteDbWithSnapshot,
  vacuumSnapshotSqliteDb,
  type CopyProductionDbResult,
} from './production-db-copy';
import { archiveSessionNdjsonLog } from './session-archive';

/** Look up the human-readable label for a model ID within a given harness. Falls back to the raw ID. */
function getModelLabel(harnessId: string, modelId: string): string {
  return MODEL_OPTIONS[harnessId]?.find((m) => m.id === modelId)?.label ?? modelId;
}

function formatProgressStepForPrompt(step: ProgressStateStep, index: number, currentIndex: number | null): string {
  const marker = currentIndex === index ? ' (current)' : '';
  const weight = step.weight !== 1 ? `, weight ${step.weight}` : '';
  return `- ${step.label}: ${step.status}${marker}${weight}`;
}

function incompleteProgressPromptSection(events: SessionEvent[]): string {
  if (!events.some((event) => event.type === 'progress_plan' || event.type === 'progress_step')) return '';
  const state = reduceProgressEventsAcrossRuns(events);
  if (state.currentIndex == null) return '';
  const summary = progressSummary(state);
  const currentLabel = state.steps[state.currentIndex]?.label ?? 'unknown';
  return `\n\nProgress task list note: the previous agent turn did not finish its progress task list. Continue from the current task list state instead of starting a new \`Make a plan\` list. Current task: \`${currentLabel}\`. Completion: ${summary.completeSteps}/${summary.totalSteps} steps (${summary.weightedPercent}% weighted).\n${state.steps.map((step, index) => formatProgressStepForPrompt(step, index, state.currentIndex)).join('\n')}`;
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
  /** User's Primordia AES JWK, passed only via PRIMORDIA_AES_KEY to workers. */
  aesKey?: string;
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
  /** User's Primordia AES JWK. NOT written to the JSON config file; passed via PRIMORDIA_AES_KEY. */
  aesKey?: string;
  /** Preset-selected billing/auth source. Used to prevent silent gateway fallback. */
  authSource?: string | null;
  /**
   * Primordia user ID. CLAUDE_CONFIG_DIR is pointed at a per-user directory
   * so each user's Claude config is isolated.
   * Written to the JSON config file so the worker can load the user's selected secret.
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
  aesKey: string | undefined,
  harnessId: string,
  modelId?: string,
  requestedAuthSource?: string | null,
): { auth: AgentAuthInfo; resolvedAesKey: string | undefined } {
  if (requestedAuthSource === 'chatgpt-subscription') {
    if (harnessId !== 'pi' && harnessId !== 'codex') {
      throw new Error('ChatGPT subscription auth is only supported by the Pi and Codex harnesses. Choose a ChatGPT-compatible preset.');
    }
    if (harnessId === 'pi' && !modelId?.startsWith('openai-codex:')) {
      throw new Error('ChatGPT subscription auth for Pi requires an openai-codex model. Choose a ChatGPT subscription model.');
    }
    if (!aesKey) {
      throw new Error('ChatGPT subscription was selected, but the Primordia AES key was not provided. Reconnect ChatGPT in Settings → Billing sources, then try again.');
    }
    return { auth: { source: 'chatgpt-subscription' }, resolvedAesKey: aesKey };
  }

  if (requestedAuthSource === 'claude-subscription') {
    if (harnessId !== 'claude-code') {
      throw new Error('Claude subscription auth is only supported by the Claude Code harness. Choose a Claude-compatible preset.');
    }
    if (!aesKey) {
      throw new Error('Claude subscription was selected, but the Primordia AES key was not provided. Reconnect Claude in Settings → Billing sources, then try again.');
    }
    return { auth: { source: 'claude-credentials' }, resolvedAesKey: aesKey };
  }

  if (requestedAuthSource && requestedAuthSource !== 'exe-dev-gateway') {
    if (!aesKey) {
      throw new Error('The selected API key billing source is missing the Primordia AES key. Reconnect it in Settings, then try again.');
    }
    return { auth: { source: 'api-key' }, resolvedAesKey: aesKey };
  }

  return { auth: { source: 'llm-gateway' }, resolvedAesKey: undefined };
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
  waitForExit = true,
): Promise<void> {
  checkWorktreeNotBusy(config.worktreePath);

  // Strip the Primordia AES key from the JSON config file so it is never
  // written to disk. Workers receive only the user/auth-source IDs in config and
  // use PRIMORDIA_AES_KEY to decrypt the matching stored secret themselves.
  const { aesKey: workerAesKey, ...configWithoutSensitive } = config;
  const configFile = `/tmp/primordia-worker-${config.sessionId}.json`;
  fs.writeFileSync(configFile, JSON.stringify(configWithoutSensitive), 'utf8');

  const workerEnv: NodeJS.ProcessEnv = { ...process.env };
  if (workerAesKey) {
    workerEnv['PRIMORDIA_AES_KEY'] = workerAesKey;
  }
  const homeDir = process.env.HOME ?? '/home/exedev';
  workerEnv['CLAUDE_CONFIG_DIR'] = path.join(homeDir, '.claude-users', config.userId);

  return new Promise<void>((resolve, reject) => {
    const proc = spawn('bun', ['run', workerScriptPath, configFile], {
      cwd: config.repoRoot,
      detached: true,
      env: workerEnv,
      stdio: waitForExit ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    });

    if (!proc.pid) {
      fs.rmSync(configFile, { force: true });
      reject(new Error('Failed to spawn agent worker: no PID assigned'));
      return;
    }

    // Unref so the worker keeps running even if the server exits.
    proc.unref();
    activeWorkerPids.set(config.sessionId, proc.pid);

    if (!waitForExit) {
      resolve();
      return;
    }

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

function isPreviewServerRunning(destinationWorktreePath: string, devServerPort: number | null | undefined, repoRoot: string): boolean {
  if (!devServerPort) return false;
  const destinationRealPath = (() => {
    try { return fs.realpathSync(destinationWorktreePath); } catch { return path.resolve(destinationWorktreePath); }
  })();
  try {
    return getProcessStatusReport(repoRoot).worktrees.some((worktree) => {
      const worktreeRealPath = (() => {
        try { return fs.realpathSync(worktree.path); } catch { return path.resolve(worktree.path); }
      })();
      return worktree.port === devServerPort && worktreeRealPath === destinationRealPath && worktree.servers.length > 0;
    });
  } catch {
    return false;
  }
}

function actionableHotswapError(devServerPort: number, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(
    `Preview server appears to be running on port ${devServerPort}, but its database hotswap endpoint could not be reached. ` +
    `Restart the preview server with \`bun run primordia restart --worktree <thread>\`, then retry Apply Updates. ` +
    `Original error: ${message}`,
  );
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

    if (devServerPort && isPreviewServerRunning(destinationWorktreePath, devServerPort, repoRoot)) {
      try {
        const response = await fetch(`http://127.0.0.1:${devServerPort}/api/evolve/hotswap-db`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ snapshotFilename }),
        });
        if (response.ok) {
          return { copied: true, sourcePath, destinationPath, method: 'hot-swap' };
        }
        const text = await response.text().catch(() => '');
        throw new Error(`preview server hotswap endpoint returned HTTP ${response.status}${text ? `: ${text}` : ''}`);
      } catch (err) {
        // If process-manager says the preview server is running, connection
        // errors are actionable: the port owner is stale, wedged, or not serving
        // the hotswap route. Do not overwrite the DB underneath a live process.
        throw actionableHotswapError(devServerPort, err);
      }
    }

    replaceSqliteDbWithSnapshot(snapshotPath, destinationPath);
    return { copied: true, sourcePath, destinationPath, method: 'direct-copy' };
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
    /** When false, return as soon as the independent worker process is spawned. */
    waitForWorkerExit?: boolean;
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
      let installLog = '';
      const proc = spawn('mise', ['exec', '-C', session.worktreePath, '--', 'bun', 'install'], {
        cwd: session.worktreePath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      proc.stdout.on('data', (chunk: Buffer) => { installLog += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { installLog += chunk.toString(); });
      proc.on('close', (code) => {
        if (code === 0) {
          appendSessionEvent(ndjsonPath, { type: 'setup_step', label: '`bun install` complete', done: true, ts: Date.now() });
          resolve();
        } else {
          const detail = installLog.trim() ? `\n${installLog.trim()}` : '';
          reject(new Error(withSocketStatusHint(`bun install failed with exit code ${code}${detail}`, installLog)));
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
    const { auth, resolvedAesKey } = resolveAgentAuth(session.aesKey, harnessId, modelId, session.authSource);
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
        aesKey: resolvedAesKey,
        authSource: session.authSource,
        userId: session.userId,
      },
      workerScript,
      options.waitForWorkerExit ?? true,
    );
    if (options.waitForWorkerExit === false) return;
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
async function runFollowupThreadInWorktree(
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
  requestMetadata: { presetId?: string } = {},
  waitForWorkerExit = true,
): Promise<void> {
  const ndjsonPath = getSessionNdjsonPath(session.worktreePath);

  try {
    if (!internalSectionType) {
      const preset = await resolveThreadPreset(session.userId, requestMetadata.presetId);
      session.harness = preset.harness;
      session.model = preset.model;
      session.authSource = preset.authSource;
      requestMetadata = { presetId: preset.id };
    }

    const fuHarnessId = session.harness ?? DEFAULT_HARNESS;
    const fuModelId = session.model ?? DEFAULT_MODEL;
    const progressCarryoverSection = incompleteProgressPromptSection(readSessionEvents(ndjsonPath).events);

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
      const fuAuth = resolveAgentAuth(session.aesKey, fuHarnessId, fuModelId, session.authSource);
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
      `${followupRequest}${attachmentSection}${progressCarryoverSection}\n\n` +
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
          const r = resolveAgentAuth(session.aesKey, fuHarnessId, fuModelId, session.authSource);
          return { aesKey: r.resolvedAesKey };
        })(),
        authSource: session.authSource,
        userId: session.userId,
      },
      fuWorkerScript,
      waitForWorkerExit,
    );

    if (!waitForWorkerExit) return;

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

export interface FollowupThreadOptions {
  userId: string;
  threadId: string;
  requestText: string;
  presetId?: string | null;
  primordiaAesKey?: string | null;
  attachmentPaths?: string[];
  /** When false, wait for setup and independent worker spawn before returning. Defaults to endpoint-style fire-and-forget behavior. */
  runInBackground?: boolean;
}

export async function followupThread(
  options: FollowupThreadOptions,
): Promise<{ ok: true; threadId: string } | { ok: false; status: 400 | 403 | 404; error: string }>;
export async function followupThread(
  session: LocalSession,
  followupRequest: string,
  repoRoot: string,
  inProgressStatus?: LocalSessionStatus,
  onSuccess?: (session: LocalSession) => Promise<void>,
  internalSectionType?: 'type_fix' | 'auto_commit',
  attachmentPaths?: string[],
  requestMetadata?: { presetId?: string },
): Promise<void>;
export async function followupThread(
  first: FollowupThreadOptions | LocalSession,
  followupRequest?: string,
  repoRoot: string = process.cwd(),
  inProgressStatus: LocalSessionStatus = 'running-claude',
  onSuccess?: (session: LocalSession) => Promise<void>,
  internalSectionType?: 'type_fix' | 'auto_commit',
  attachmentPaths: string[] = [],
  requestMetadata: { presetId?: string } = {},
): Promise<void | { ok: true; threadId: string } | { ok: false; status: 400 | 403 | 404; error: string }> {
  if ('threadId' in first) {
    const options = first;
    if (!(await hasEvolvePermission(options.userId))) {
      return { ok: false, status: 403, error: 'User does not have evolve permission.' };
    }
    const record = getSessionFromFilesystem(options.threadId, repoRoot);
    if (!record) return { ok: false, status: 404, error: 'Session not found' };
    if (record.status !== 'ready') {
      return { ok: false, status: 400, error: `Session is not in a state that accepts follow-up requests (current status: ${record.status})` };
    }
    const session: LocalSession = {
      id: record.id,
      branch: record.branch,
      worktreePath: record.worktreePath,
      status: record.status as LocalSession['status'],
      devServerStatus: record.previewUrl ? 'running' : 'none',
      port: record.port,
      previewUrl: record.previewUrl,
      request: record.request,
      createdAt: record.createdAt,
      aesKey: options.primordiaAesKey ?? undefined,
      userId: options.userId,
    };
    const runPromise = runFollowupThreadInWorktree(
      session,
      options.requestText,
      repoRoot,
      'running-claude',
      undefined,
      undefined,
      options.attachmentPaths ?? [],
      options.presetId ? { presetId: options.presetId } : {},
      options.runInBackground ?? true,
    );
    if (options.runInBackground ?? true) void runPromise;
    else await runPromise;
    return { ok: true, threadId: options.threadId };
  }

  if (!(await hasEvolvePermission(first.userId))) {
    throw new Error('User does not have evolve permission.');
  }
  await runFollowupThreadInWorktree(
    first,
    followupRequest ?? '',
    repoRoot,
    inProgressStatus,
    onSuccess,
    internalSectionType,
    attachmentPaths,
    requestMetadata,
  );
}

// ─── Restart dev server ───────────────────────────────────────────────────────

/**
 * Restarts the preview server for a session via the shared process manager.
 * Kept for backward compatibility with older callers.
 */
export async function restartDevServerInWorktree(
  session: LocalSession,
  repoRoot: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _publicHostname: string = "localhost",
): Promise<void> {
  await restartWorktreeServer(session.id, 'dev', repoRoot);
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
  sessionContext: { id: string; harness?: string; model?: string; aesKey?: string; authSource?: string | null; userId: string },
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
        ...(() => {
          const r = resolveAgentAuth(sessionContext.aesKey, harnessId, sessionContext.model, sessionContext.authSource);
          return { aesKey: r.resolvedAesKey };
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


/** Return latest harness/model/auth source recorded in the session log. */
function getLatestAgentSelection(worktreePath: string): { harness?: string; model?: string; authSource?: PresetAuthSource | null } {
  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  if (!fs.existsSync(ndjsonPath)) return {};
  const { events } = readSessionEvents(ndjsonPath);
  let authSource: PresetAuthSource | null | undefined;

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if ((event.type === 'followup_request' || event.type === 'initial_request') && typeof event.authSource === 'string' && authSource === undefined) {
      authSource = normalizeAuthSource(event.authSource) ?? undefined;
    }
    if (event.type === 'section_start' && event.sectionType === 'agent') {
      return { harness: event.harnessId, model: event.modelId, authSource };
    }
    if ((event.type === 'followup_request' || event.type === 'initial_request') && (event.harness || event.model)) {
      return { harness: event.harness, model: event.model, authSource };
    }
  }

  return { authSource };
}

/** Well-known filename used to track the PID of a running install.sh process. */
export const INSTALL_SH_PID_FILE = '.primordia-installsh.pid';
const INSTALL_EXIT_TYPECHECK = 2;

async function appendLogLine(sessionId: string, content: string, repoRoot = process.cwd()): Promise<void> {
  const row = getSessionFromFilesystem(sessionId, repoRoot);
  if (!row) return;
  const ndjsonPath = getSessionNdjsonPath(row.worktreePath);
  if (fs.existsSync(ndjsonPath)) appendSessionEvent(ndjsonPath, { type: 'log_line', content, ts: Date.now() });
}

function runInstallSh(sessionId: string, worktreePath: string, branch: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const installScript = path.join(worktreePath, 'scripts', 'install.sh');
    const proc = spawn('bash', [installScript, branch], {
      cwd: worktreePath,
      env: { ...process.env, REPORT_STYLE: 'ansi' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (proc.pid !== undefined) {
      try { fs.writeFileSync(path.join(worktreePath, INSTALL_SH_PID_FILE), String(proc.pid)); } catch { /* non-fatal */ }
    }
    const forward = (data: Buffer) => { void appendLogLine(sessionId, data.toString()); };
    proc.stdout.on('data', forward);
    proc.stderr.on('data', forward);
    proc.on('exit', (code) => {
      setTimeout(() => {
        proc.stdout.destroy();
        proc.stderr.destroy();
        try { fs.unlinkSync(path.join(worktreePath, INSTALL_SH_PID_FILE)); } catch { /* already gone */ }
        resolve(code ?? 1);
      }, 250);
    });
    proc.on('error', (err) => reject(new Error(`install.sh spawn failed: ${err.message}`)));
  });
}

async function retryAcceptAfterFix(sessionId: string, repoRoot: string, parentBranch: string): Promise<void> {
  const current = getSessionFromFilesystem(sessionId, repoRoot);
  if (!current) return;
  const { branch, worktreePath } = current;

  async function failWithError(msg: string): Promise<void> {
    await appendLogLine(sessionId, msg, repoRoot);
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'error', message: msg, ts: Date.now() });
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  if (fs.existsSync(ndjsonPath)) {
    appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: 'deploy', label: isProduction ? '🚀 Deploying to production' : `🚀 Merging into \`${parentBranch}\``, ts: Date.now() });
  }

  try { await stopWorktreeServer(sessionId, repoRoot); } catch { /* preview server may already be gone */ }
  if (!isProduction) {
    await failWithError('❌ Auto-fix retry is only supported in production mode.');
    return;
  }

  const exitCode = await runInstallSh(sessionId, worktreePath, branch).catch((err) => {
    void failWithError(`❌ Auto-fix failed (install.sh spawn error): ${err instanceof Error ? err.message : String(err)}`);
    return -1;
  });
  if (exitCode === -1) return;
  if (exitCode === INSTALL_EXIT_TYPECHECK) {
    const errorsFile = path.join(worktreePath, '.primordia-typecheck-errors.txt');
    const typeErrors = fs.existsSync(errorsFile) ? fs.readFileSync(errorsFile, 'utf8').trim() : '(no output captured)';
    await failWithError(`❌ Auto-fix failed: TypeScript errors remain after the fix attempt.\n\`\`\`\n${typeErrors}\n\`\`\``);
    return;
  }
  if (exitCode !== 0) {
    await failWithError(`❌ Auto-fix failed: install.sh exited with code ${exitCode}.`);
    return;
  }
  if (fs.existsSync(ndjsonPath)) appendSessionEvent(ndjsonPath, { type: 'decision', action: 'accepted', detail: 'deployed to production', ts: Date.now() });
  setTimeout(() => process.exit(0), 1000);
}

async function runAcceptAsync(
  sessionId: string,
  worktreePath: string,
  branch: string,
  parentBranch: string,
  repoRoot: string,
  userId: string,
  aesKey?: string,
  authSource?: PresetAuthSource | null,
  harness?: string,
  model?: string,
): Promise<void> {
  const step = (text: string) => appendLogLine(sessionId, text, repoRoot);
  async function failWithError(msg: string): Promise<void> {
    await appendLogLine(sessionId, msg, repoRoot);
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'error', message: msg, ts: Date.now() });
  }

  try {
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      try { await stopWorktreeServer(sessionId, repoRoot); } catch { /* dev server may already be gone */ }
      const warmupPidFile = path.join(worktreePath, '.primordia-warmup-build.pid');
      if (fs.existsSync(warmupPidFile)) {
        try {
          const warmupPid = parseInt(fs.readFileSync(warmupPidFile, 'utf8').trim(), 10);
          if (!isNaN(warmupPid)) {
            try { process.kill(-warmupPid, 'SIGTERM'); } catch { /* already gone */ }
            try { process.kill(warmupPid, 'SIGTERM'); } catch { /* already gone */ }
          }
        } catch { /* non-fatal */ }
        try { fs.unlinkSync(warmupPidFile); } catch { /* non-fatal */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const exitCode = await runInstallSh(sessionId, worktreePath, branch);
      if (exitCode === INSTALL_EXIT_TYPECHECK) {
        const errorsFile = path.join(worktreePath, '.primordia-typecheck-errors.txt');
        const typeErrors = fs.existsSync(errorsFile) ? fs.readFileSync(errorsFile, 'utf8').trim() : '(no output captured)';
        const fixPrompt = `The TypeScript type check failed. Fix all type errors so the code compiles without errors. Do not change any runtime behaviour — only fix the type issues.\n\nTypeScript compiler output:\n\`\`\`\n${typeErrors}\n\`\`\``;
        const sessionSnap = getSessionFromFilesystem(sessionId, repoRoot);
        if (!sessionSnap) return;
        const autoFixSession: LocalSession = { id: sessionSnap.id, branch: sessionSnap.branch, worktreePath: sessionSnap.worktreePath, status: sessionSnap.status as LocalSession['status'], devServerStatus: 'running', port: sessionSnap.port, previewUrl: sessionSnap.previewUrl, request: sessionSnap.request, createdAt: sessionSnap.createdAt, userId, aesKey, authSource, harness, model };
        void followupThread(autoFixSession, fixPrompt, repoRoot, 'fixing-types', (fixedSession) => retryAcceptAfterFix(fixedSession.id, repoRoot, parentBranch), 'type_fix');
        return;
      }
      if (exitCode !== 0) throw new Error(`install.sh exited with code ${exitCode}`);
      const ndjsonPath = getSessionNdjsonPath(worktreePath);
      if (fs.existsSync(ndjsonPath)) appendSessionEvent(ndjsonPath, { type: 'decision', action: 'accepted', detail: 'deployed to production', ts: Date.now() });
      setTimeout(() => process.exit(0), 1000);
      return;
    }

    const checkoutResult = await runGit(['checkout', parentBranch], repoRoot);
    let mergeRoot = repoRoot;
    if (checkoutResult.code !== 0) {
      const alreadyCheckedOutMatch = checkoutResult.stderr.match(/(?:already checked out at|already used by worktree at) '([^']+)'/);
      if (alreadyCheckedOutMatch) mergeRoot = alreadyCheckedOutMatch[1];
      else {
        await failWithError(`❌ Accept failed: \`git checkout ${parentBranch}\` failed:\n${checkoutResult.stderr}`);
        return;
      }
    }

    let stashed = false;
    const statusResult = await runGit(['status', '--porcelain'], mergeRoot);
    if (statusResult.stdout.trim()) {
      const stashResult = await runGit(['stash', 'push', '-u', '-m', 'primordia-auto-stash-before-merge'], mergeRoot);
      stashed = stashResult.code === 0 && !stashResult.stdout.includes('No local changes');
    }

    await step('- Merging branch…\n');
    const mergeResult = await runGit(['merge', branch, '--no-ff', '-m', `chore: merge ${branch}`], mergeRoot);
    if (mergeResult.code !== 0) {
      await runGit(['merge', '--abort'], mergeRoot);
      if (stashed) await runGit(['stash', 'pop'], mergeRoot);
      await failWithError(`❌ Accept failed: merge conflict in ${mergeRoot}.\nThis should not happen when the branch is up-to-date. Use Apply Updates on the session page to resolve conflicts before accepting.\n\nMerge error:\n${mergeResult.stderr}`);
      return;
    }
    if (stashed) {
      const popResult = await runGit(['stash', 'pop'], mergeRoot);
      if (popResult.code !== 0) await step('⚠️ Merge succeeded but restoring stashed changes produced a conflict. Run `git stash pop` manually to resolve.');
    }
    await step('- Installing dependencies…\n');
    const installResult = await runCommand('bun', ['install', '--frozen-lockfile'], mergeRoot);
    if (installResult.code !== 0) {
      const installLog = (installResult.stdout + installResult.stderr).trim();
      await failWithError(withSocketStatusHint(`❌ Accept failed: \`bun install --frozen-lockfile\` failed after merge.\n\`\`\`\n${installLog}\n\`\`\``, installLog));
      return;
    }
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (fs.existsSync(ndjsonPath)) appendSessionEvent(ndjsonPath, { type: 'decision', action: 'accepted', detail: `merged into \`${parentBranch}\``, ts: Date.now() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failWithError(`❌ Accept failed (unexpected error): ${msg}`).catch(() => {});
  }
}

export interface UpdateThreadOptions {
  userId: string;
  threadId: string;
}

export type UpdateThreadResult =
  | { ok: true; status: 200; outcome: 'merged' | 'merged-with-conflict-resolution'; log: string }
  | { ok: false; status: 400 | 403 | 404 | 500; error: string };

async function runBunInstallAfterMerge(worktreePath: string): Promise<string> {
  const installResult = await runCommand('bun', ['install'], worktreePath);
  const installLog = installResult.stdout + installResult.stderr;
  if (installResult.code !== 0) {
    throw new Error(withSocketStatusHint(`bun install failed after merge:\n${installLog || `exit code ${installResult.code}`}`, installLog));
  }
  return installLog;
}

export async function updateThread({ userId, threadId }: UpdateThreadOptions): Promise<UpdateThreadResult> {
  if (!(await hasEvolvePermission(userId))) return { ok: false, status: 403, error: 'User does not have evolve permission.' };
  const repoRoot = process.cwd();
  const session = getSessionFromFilesystem(threadId, repoRoot);
  if (!session) return { ok: false, status: 404, error: 'Thread not found' };

  const { worktreePath, branch } = session;
  const parentSource = await getBranchParentSource(userId);
  const parentBranch = getParentBranch(branch, undefined, parentSource);
  if (!parentBranch) return { ok: false, status: 400, error: 'Could not determine parent thread' };

  try {
    const result = await runGit(['merge', parentBranch, '--no-ff', '-m', `chore: merge ${parentBranch} into ${branch}`], worktreePath);
    let outcome: 'merged' | 'merged-with-conflict-resolution' = 'merged';
    let conflictLog = '';
    if (result.code !== 0) {
      const resolution = await resolveConflictsWithAgent(worktreePath, parentBranch, branch, { id: session.id, userId }, repoRoot);
      if (!resolution.success) {
        await runGit(['merge', '--abort'], worktreePath);
        return { ok: false, status: 500, error: `Merge failed and automatic conflict resolution also failed:\n${resolution.log}` };
      }
      outcome = 'merged-with-conflict-resolution';
      conflictLog = '\n\n' + resolution.log;
    }

    const installLog = await runBunInstallAfterMerge(worktreePath);
    const dbCopy = await hotswapProductionDbIntoWorktree(repoRoot, worktreePath, session.port);
    const dbCopyLog = dbCopy.copied
      ? dbCopy.method === 'hot-swap'
        ? '\nHot-swapped a production DB snapshot into this thread.'
        : '\nCopied a production DB snapshot into this thread.'
      : dbCopy.error === 'production DB not found'
        ? '\nSkipped production DB copy: production DB not found.'
        : `\nSkipped production DB copy: ${dbCopy.error ?? 'unknown error'}.`;
    return {
      ok: true,
      status: 200,
      outcome,
      log: result.stdout + result.stderr + conflictLog + (installLog ? '\n' + installLog : '') + dbCopyLog,
    };
  } catch (err) {
    return { ok: false, status: 500, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ManageThreadOptions {
  userId: string;
  threadId: string;
  action: 'accept' | 'reject';
  authSource?: PresetAuthSource | string | null;
  primordiaAesKey?: string | null;
}

export type ManageThreadResult =
  | { ok: true; status: 200; outcome: 'accepting' | 'auto-committing' | 'rejected' }
  | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string; stuckSessionId?: string; stuckSessionBranch?: string };

export async function manageThread({ userId, threadId, action, authSource: requestedAuthSource, primordiaAesKey }: ManageThreadOptions): Promise<ManageThreadResult> {
  if (!(await hasEvolvePermission(userId))) return { ok: false, status: 403, error: 'User does not have evolve permission.' };
  const repoRoot = process.cwd();
  const session = getSessionFromFilesystem(threadId, repoRoot);
  if (!session) return { ok: false, status: 404, error: 'Thread not found' };

  const { branch, worktreePath } = session;
  const agentSelection = getLatestAgentSelection(worktreePath);
  const authSource = requestedAuthSource !== undefined && requestedAuthSource !== null
    ? normalizeAuthSource(requestedAuthSource)
    : agentSelection.authSource ?? null;
  const needsStoredSecret = authSource !== null && authSource !== 'exe-dev-gateway';
  const aesKey = primordiaAesKey ?? undefined;
  if (action === 'accept' && needsStoredSecret && !aesKey) return { ok: false, status: 400, error: 'Selected billing source requires this device’s Primordia AES key. Reconnect it in Settings, then try again.' };
  const encryptedSecret = action === 'accept' ? await getEncryptedSecretForUser(userId, authSource) : null;
  if (action === 'accept' && needsStoredSecret && !encryptedSecret) return { ok: false, status: 400, error: 'Selected billing source has no stored secret. Reconnect it in Settings, then try again.' };

  const parentSource = await getBranchParentSource(userId);
  const parentBranch = getParentBranch(branch, undefined, parentSource) ?? 'main';
  const isProduction = process.env.NODE_ENV === 'production';
  if (action === 'reject' || isProduction) {
    try { await stopWorktreeServer(threadId, repoRoot); } catch { /* preview server may already be gone */ }
  }

  const logDecision = (decision: 'accept' | 'reject'): void => {
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    if (!fs.existsSync(ndjsonPath)) return;
    const detail = decision === 'accept' ? (isProduction ? 'deployed to production' : `merged into \`${parentBranch}\``) : 'changes discarded';
    appendSessionEvent(ndjsonPath, { type: 'decision', action: decision === 'accept' ? 'accepted' : 'rejected', detail, ts: Date.now() });
  };

  try {
    if (action === 'accept') {
      const ancestorCheck = await runGit(['merge-base', '--is-ancestor', parentBranch, 'HEAD'], worktreePath);
      if (ancestorCheck.code !== 0) {
        const mergeResult = await runGit(['merge', parentBranch, '--no-ff', '-m', `chore: merge ${parentBranch} into ${branch}`], worktreePath);
        if (mergeResult.code !== 0) {
          const resolution = await resolveConflictsWithAgent(worktreePath, parentBranch, branch, { id: threadId, userId, aesKey, authSource, harness: agentSelection.harness, model: agentSelection.model }, repoRoot);
          if (!resolution.success) {
            await runGit(['merge', '--abort'], worktreePath);
            return { ok: false, status: 400, error: `Cannot accept: thread is not up-to-date with "${parentBranch}" and automatic merge failed:\n${resolution.log}` };
          }
        }
      }

      const worktreeStatus = await runGit(['status', '--porcelain'], worktreePath);
      if (worktreeStatus.stdout.trim()) {
        const commitPrompt = `This thread has uncommitted changes that must be committed before it can be accepted into production. Please commit all uncommitted changes with a clear, descriptive git commit message. Do not modify any files — only stage and commit the existing changes.\n\nUncommitted changes:\n\`\`\`\n${worktreeStatus.stdout.trim()}\n\`\`\`\n\nDo NOT create or update the changelog file for this commit.`;
        const commitSession: LocalSession = { id: session.id, branch: session.branch, worktreePath: session.worktreePath, status: 'ready', devServerStatus: 'running', port: session.port, previewUrl: session.previewUrl, request: session.request, createdAt: session.createdAt, userId, aesKey, authSource, harness: agentSelection.harness, model: agentSelection.model };
        void followupThread(commitSession, commitPrompt, repoRoot, 'running-claude', undefined, 'auto_commit');
        return { ok: true, status: 200, outcome: 'auto-committing' };
      }

      const concurrentDeploy = listSessionsFromFilesystem(repoRoot).find((s) => s.status === 'accepting' && s.id !== threadId);
      if (concurrentDeploy) {
        return { ok: false, status: 409, error: `A deploy is already in progress (thread "${concurrentDeploy.branch}"). Please wait for it to finish, then try again.`, stuckSessionId: concurrentDeploy.id, stuckSessionBranch: concurrentDeploy.branch };
      }

      const ndjsonPath = getSessionNdjsonPath(worktreePath);
      if (fs.existsSync(ndjsonPath)) appendSessionEvent(ndjsonPath, { type: 'section_start', sectionType: 'deploy', label: isProduction ? '🚀 Deploying to production' : `🚀 Merging into \`${parentBranch}\``, ts: Date.now() });
      void runAcceptAsync(threadId, worktreePath, branch, parentBranch, repoRoot, userId, aesKey, authSource, agentSelection.harness, agentSelection.model);
      return { ok: true, status: 200, outcome: 'accepting' };
    }

    logDecision('reject');
    archiveSessionNdjsonLog(worktreePath, { sessionId: branch, primordiaDir: process.env.PRIMORDIA_DIR || repoRoot });
    await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot);
    await runGit(['branch', '-D', branch], repoRoot);
    await runGit(['config', '--remove-section', `branch.${branch}`], repoRoot);
    return { ok: true, status: 200, outcome: 'rejected' };
  } catch (err) {
    return { ok: false, status: 500, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Thread creation facade ─────────────────────────────────────────────────

const ANTHROPIC_GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/anthropic';
const OPENAI_GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/openai';

type SlugModelProvider = 'anthropic' | 'openai' | 'openai-codex' | 'openrouter' | 'google';

export interface CreateThreadOptions {
  userId: string;
  requestText: string;
  cavemanMode?: boolean;
  cavemanIntensity?: CavemanIntensity;
  presetId?: string | null;
  primordiaAesKey?: string | null;
  savedAttachmentPaths?: string[];
  /** When false, wait for setup and independent worker spawn before returning. Defaults to endpoint-style fire-and-forget behavior. */
  runInBackground?: boolean;
}

export type CreateThreadResult =
  | { ok: true; status: 200; sessionId: string; worktreePath: string }
  | { ok: false; status: 400 | 403 | 500; error: string };

async function resolveThreadPreset(userId: string, requestedPresetId?: string | null): Promise<EvolvePreset> {
  const db = await getDb();
  const prefs = await db.getUserPreferences(userId, [PREF_PRESET, PREF_CUSTOM_PRESETS]);
  const customPresets = parseCustomPresets(prefs[PREF_CUSTOM_PRESETS]);
  const presets: EvolvePreset[] = [...BUILT_IN_PRESETS, ...customPresets];
  const presetId = requestedPresetId ?? prefs[PREF_PRESET] ?? BUILT_IN_PRESETS[0]?.id;
  const preset = presetId ? presets.find((candidate) => candidate.id === presetId) : null;
  if (!preset) throw new Error(`Preset not found: ${presetId}`);
  return preset;
}

/** Infer the pi provider and strip any Primordia-only model ID namespace. */
function normalizeSlugModelSelection(modelId: string): { provider: SlugModelProvider; modelId: string } {
  if (modelId.startsWith('openai-codex:')) {
    return { provider: 'openai-codex', modelId: modelId.slice('openai-codex:'.length) };
  }
  if (modelId.startsWith('gpt-') || /^o\d/.test(modelId) || modelId.startsWith('codex-')) {
    return { provider: 'openai', modelId };
  }
  if (modelId.startsWith('gemini-')) return { provider: 'google', modelId };
  if (modelId.includes('/')) return { provider: 'openrouter', modelId };
  return { provider: 'anthropic', modelId };
}

function cleanGeneratedSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function fallbackSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-') || 'evolve-session';
}

/** Ask the selected evolve model to choose a short, descriptive kebab-case slug for the request. */
async function generateSlug(
  text: string,
  model: string,
  authSource: PresetAuthSource | null,
  apiKey?: string,
  chatGptOAuth?: string,
): Promise<string> {
  try {
    const { provider, modelId } = normalizeSlugModelSelection(model);
    const authStorage = AuthStorage.inMemory();

    if (authSource === 'chatgpt-subscription' && provider === 'openai-codex' && chatGptOAuth) {
      const stored = JSON.parse(chatGptOAuth) as {
        tokens?: {
          accessToken?: string;
          refreshToken?: string;
          accountId?: string | null;
          accessTokenExpiresAt?: number | null;
        };
      };
      const access = stored.tokens?.accessToken;
      const refresh = stored.tokens?.refreshToken;
      if (access && refresh) {
        authStorage.set('openai-codex', {
          type: 'oauth',
          access,
          refresh,
          expires: stored.tokens?.accessTokenExpiresAt ?? 0,
          accountId: stored.tokens?.accountId ?? undefined,
        });
      }
    } else if (apiKey) {
      authStorage.setRuntimeApiKey(provider, apiKey);
    } else if (authSource === 'exe-dev-gateway' || authSource === 'claude-subscription' || authSource === null) {
      // The exe.dev gateway handles Anthropic/OpenAI auth with any non-empty key.
      authStorage.setRuntimeApiKey('anthropic', 'gateway');
      authStorage.setRuntimeApiKey('openai', 'gateway');
    }

    const modelRegistry = ModelRegistry.create(authStorage, ensurePrimordiaPiModelsJson());
    if (!apiKey && (authSource === 'exe-dev-gateway' || authSource === 'claude-subscription' || authSource === null)) {
      modelRegistry.registerProvider('anthropic', { baseUrl: ANTHROPIC_GATEWAY_BASE_URL });
      modelRegistry.registerProvider('openai', { baseUrl: OPENAI_GATEWAY_BASE_URL });
    }

    const selectedModel = modelRegistry.find(provider, modelId);
    if (!selectedModel) throw new Error(`Model '${modelId}' not found for provider '${provider}'`);

    const auth = await modelRegistry.getApiKeyAndHeaders(selectedModel);
    if (!auth.ok) throw new Error(auth.error);

    const userMessage: UserMessage = {
      role: 'user',
      content:
        `Generate a short kebab-case slug (2–4 words, lowercase, hyphens only) that ` +
        `captures the essence of this feature request. Reply with only the slug, nothing else.\n\n` +
        `Request: ${text}`,
      timestamp: Date.now(),
    };

    const response = await complete(
      selectedModel,
      { messages: [userMessage] },
      { apiKey: auth.apiKey, headers: auth.headers, maxTokens: 32 },
    );
    const generatedText = response.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    const cleaned = cleanGeneratedSlug(generatedText);
    if (cleaned.length > 0) return cleaned;
  } catch {
    // Fall through to simple fallback.
  }
  return fallbackSlug(text);
}

/** Return a branch name that doesn't already exist in the repo. */
async function findUniqueBranch(slug: string, repoRoot: string): Promise<string> {
  const base = slug;
  const taken = async (name: string): Promise<boolean> => {
    const r = await runGit(['branch', '--list', name], repoRoot);
    return r.stdout.trim().length > 0;
  };
  if (!(await taken(base))) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function createThread({
  userId,
  requestText,
  cavemanMode = false,
  cavemanIntensity = DEFAULT_CAVEMAN_INTENSITY,
  presetId = null,
  primordiaAesKey = null,
  savedAttachmentPaths = [],
  runInBackground = true,

}: CreateThreadOptions): Promise<CreateThreadResult> {
  if (!(await hasEvolvePermission(userId))) {
    return { ok: false, status: 403, error: 'User does not have evolve permission.' };
  }

  let preset: EvolvePreset;
  try {
    preset = await resolveThreadPreset(userId, presetId);
  } catch (err) {
    return { ok: false, status: 400, error: err instanceof Error ? err.message : String(err) };
  }
  const harness = preset.harness;
  const model = preset.model;
  const authSource = preset.authSource;
  presetId = preset.id;

  const needsStoredSecret = authSource !== null && authSource !== 'exe-dev-gateway';
  if (needsStoredSecret && !primordiaAesKey) {
    return { ok: false, status: 400, error: 'Selected billing source requires this device’s Primordia AES key. Reconnect the billing source in Settings, then try again.' };
  }

  const encryptedSecret = await getEncryptedSecretForUser(userId, authSource);
  if (needsStoredSecret && !encryptedSecret) {
    return { ok: false, status: 400, error: 'Selected billing source has no stored secret. Reconnect it in Settings, then try again.' };
  }

  let decryptedApiKeyForSlug: string | undefined;
  let decryptedChatGptOAuthForSlug: string | undefined;
  if (encryptedSecret && primordiaAesKey) {
    try {
      const decrypted = await decryptStoredSecretForUser(userId, authSource as SecretAuthSource, primordiaAesKey);
      if (authSource === 'chatgpt-subscription') decryptedChatGptOAuthForSlug = decrypted ?? undefined;
      else if (authSource !== 'claude-subscription') decryptedApiKeyForSlug = decrypted ?? undefined;
    } catch {
      return { ok: false, status: 400, error: 'Could not decrypt the selected billing source. Reconnect it in Settings, then try again.' };
    }
  }

  const repoRoot = process.cwd();
  const slug = await generateSlug(
    requestText,
    model,
    authSource,
    decryptedApiKeyForSlug,
    decryptedChatGptOAuthForSlug,
  );
  const branch = await findUniqueBranch(slug, repoRoot);
  const sessionId = branch;

  // Derive the worktree path from the git common dir so it is stable even when
  // this server is itself running inside a git worktree.
  const repoGitRoot = getRepoRoot(repoRoot);
  const worktreePath = path.join(getWorktreesDir(repoGitRoot), branch);

  const parentBranchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  const parentBranch = parentBranchResult.stdout.trim() || 'main';
  const parentShaResult = await runGit(['rev-parse', parentBranch], repoRoot);
  if (parentShaResult.code !== 0) {
    return { ok: false, status: 500, error: `Failed to resolve parent branch ${parentBranch}: ${parentShaResult.stderr}` };
  }
  const parentSha = parentShaResult.stdout.trim();

  // Create the git worktree synchronously before returning so the session page
  // is immediately reachable when the client navigates to it after the redirect.
  const wtResult = await runGit(['worktree', 'add', worktreePath, '-b', branch], repoRoot);
  if (wtResult.code !== 0) {
    return { ok: false, status: 500, error: `Failed to create thread workspace: ${wtResult.stderr}` };
  }

  const parentConfigResult = await runGit(['config', `branch.${branch}.parent`, parentBranch], repoRoot);
  if (parentConfigResult.code !== 0) {
    return { ok: false, status: 500, error: `Failed to record parent branch metadata: ${parentConfigResult.stderr}` };
  }

  try {
    writeBranchMarker(worktreePath, parentBranch, parentSha);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 500, error: msg };
  }

  // Write the initial_request event synchronously so getSessionFromFilesystem()
  // can find the session immediately (the ndjson file is the session existence marker).
  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  appendSessionEvent(ndjsonPath, {
    type: 'initial_request',
    request: requestText,
    attachments: savedAttachmentPaths.map((p) => path.basename(p)),
    ...(presetId ? { presetId } : {}),
    ...(authSource ? { authSource } : {}),
    harness,
    model,
    ts: Date.now(),
  });

  const session: LocalSession = {
    id: sessionId,
    branch,
    worktreePath,
    status: 'starting',
    devServerStatus: 'none',
    port: null,
    previewUrl: null,
    request: requestText,
    createdAt: Date.now(),
    harness,
    model,
    aesKey: primordiaAesKey ?? undefined,
    authSource,
    userId,
  };
  primordiaAesKey = null;

  const startPromise = startLocalEvolve(session, requestText, repoRoot, undefined, savedAttachmentPaths, {
    worktreeAlreadyCreated: true,
    initialEventAlreadyWritten: true,
    waitForWorkerExit: runInBackground ? true : false,
  });

  if (runInBackground) {
    // Fire-and-forget — run async so POST returns immediately with the session ID.
    // startLocalEvolve handles all error states internally and writes them to the filesystem.
    void startPromise;
  } else {
    // CLI-style callers wait only until setup completes and the independent
    // worker process has been spawned; they do not wait for agent completion.
    await startPromise;
  }

  // Persist the chosen harness/model/caveman as the user's sticky preference.
  // Fire-and-forget — a failure here must not break session creation.
  void (async () => {
    try {
      const db = await getDb();
      await db.setUserPreferences(userId, {
        [PREF_HARNESS]: harness,
        [PREF_MODEL]: model,
        ...(presetId ? { [PREF_PRESET]: presetId } : {}),
        [PREF_CAVEMAN]: String(cavemanMode),
        [PREF_CAVEMAN_INTENSITY]: cavemanIntensity,
      });
    } catch { /* ignore */ }
  })();

  return { ok: true, status: 200, sessionId, worktreePath };
}
