// lib/local-evolve-sessions.ts
// Shared in-memory state for the local evolve flow.
// Module-level singleton — shared across all API routes within the same
// Next.js dev server process. Only used when NODE_ENV=development.

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as net from 'net';
import * as fs from 'fs';

export type LocalSessionStatus =
  | 'starting'
  | 'running-claude'
  | 'starting-server'
  | 'ready'
  | 'error';

export interface LocalSession {
  id: string;
  branch: string;
  worktreePath: string;
  status: LocalSessionStatus;
  logs: string;
  port: number | null;
  previewUrl: string | null;
  /** Spawned dev server process. Null when not running or after cleanup. */
  devServerProcess: ChildProcess | null;
}

/** All active local evolve sessions, keyed by session ID. */
export const sessions = new Map<string, LocalSession>();

// ─── Port finding ─────────────────────────────────────────────────────────────

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

export async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found in range ${startPort}–${startPort + 99}`);
}

// ─── Logging ──────────────────────────────────────────────────────────────────

export function appendLog(session: LocalSession, text: string): void {
  session.logs += text;
  // Cap at 100 KB to avoid unbounded memory growth
  if (session.logs.length > 100_000) {
    session.logs = '[…earlier output truncated…]\n' + session.logs.slice(-90_000);
  }
}

// ─── Git ──────────────────────────────────────────────────────────────────────

function runGit(
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

// ─── Main flow ────────────────────────────────────────────────────────────────

export async function startLocalEvolve(
  session: LocalSession,
  taskRequest: string,
  repoRoot: string,
): Promise<void> {
  // Step 1 — Create a new git worktree on a fresh branch
  appendLog(session, `[local-evolve] Creating worktree: ${session.worktreePath}\n`);
  const wtResult = await runGit(
    ['worktree', 'add', session.worktreePath, '-b', session.branch],
    repoRoot,
  );
  if (wtResult.code !== 0) {
    throw new Error(`git worktree add failed:\n${wtResult.stderr}`);
  }
  appendLog(session, '[local-evolve] Worktree created.\n');

  // Step 2 — Symlink node_modules to avoid a full npm install (saves minutes)
  const srcMods = path.join(repoRoot, 'node_modules');
  const dstMods = path.join(session.worktreePath, 'node_modules');
  if (fs.existsSync(srcMods) && !fs.existsSync(dstMods)) {
    fs.symlinkSync(srcMods, dstMods, 'junction');
    appendLog(session, '[local-evolve] Symlinked node_modules.\n');
  }

  // Step 3 — Symlink .env.local so the preview server has the same credentials
  const srcEnv = path.join(repoRoot, '.env.local');
  const dstEnv = path.join(session.worktreePath, '.env.local');
  if (fs.existsSync(srcEnv) && !fs.existsSync(dstEnv)) {
    fs.symlinkSync(srcEnv, dstEnv);
    appendLog(session, '[local-evolve] Symlinked .env.local.\n');
  }

  // Step 4 — Run Claude Code in the worktree
  session.status = 'running-claude';
  appendLog(session, '[local-evolve] Spawning Claude Code...\n\n');

  const prompt =
    `Read PRIMORDIA.md first for architecture context, then implement the following change:\n\n` +
    `${taskRequest}\n\n` +
    `After making changes:\n` +
    `1. Update the Changelog section of PRIMORDIA.md with a brief entry.\n` +
    `2. Commit all changes with a descriptive message.`;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'claude',
      ['--dangerouslySkipPermissions', '-p', prompt],
      { cwd: session.worktreePath, env: { ...process.env } },
    );
    proc.stdout.on('data', (d: Buffer) => appendLog(session, d.toString()));
    proc.stderr.on('data', (d: Buffer) => appendLog(session, d.toString()));
    proc.on('error', (err) =>
      reject(new Error(`Failed to spawn claude: ${err.message}. Is the claude CLI installed?`)),
    );
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`claude exited with code ${code}`));
      else resolve();
    });
  });

  appendLog(session, '\n[local-evolve] Claude Code finished.\n');

  // Step 5 — Start Next.js dev server on an available port
  session.status = 'starting-server';
  const port = await findAvailablePort(3001);
  session.port = port;
  appendLog(session, `[local-evolve] Starting dev server on port ${port}...\n`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('npm', ['run', 'dev'], {
      cwd: session.worktreePath,
      env: { ...process.env, PORT: port.toString() },
      // detached=true creates a new process group so we can kill the entire tree
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // unref so this child doesn't prevent the parent event loop from exiting
    proc.unref();
    session.devServerProcess = proc;

    const onData = (d: Buffer) => {
      const text = d.toString();
      appendLog(session, text);
      // Next.js 15 prints "Ready" when the dev server is up
      if (!session.previewUrl && text.includes('Ready')) {
        session.previewUrl = `http://localhost:${port}`;
        session.status = 'ready';
        resolve();
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (err) => reject(new Error(`Dev server spawn failed: ${err.message}`)));
    proc.on('close', (code) => {
      if (session.status !== 'ready') {
        reject(new Error(`Dev server exited (code ${code ?? 'unknown'}) before becoming ready`));
      }
    });

    // Safety timeout: 2 minutes
    setTimeout(() => {
      if (session.status !== 'ready') {
        reject(new Error('Dev server startup timed out (2 min)'));
      }
    }, 120_000);
  });

  appendLog(session, `\n[local-evolve] Ready at http://localhost:${port}\n`);
}

// ─── Kill dev server ──────────────────────────────────────────────────────────

function killDevServer(session: LocalSession): void {
  const proc = session.devServerProcess;
  if (!proc || proc.killed) return;
  try {
    // Kill the entire process group (npm + next + its child workers)
    if (proc.pid !== undefined) {
      process.kill(-proc.pid, 'SIGTERM');
    }
  } catch {
    // Fallback: kill just the direct child
    proc.kill('SIGTERM');
  }
  session.devServerProcess = null;
}

// ─── Accept ───────────────────────────────────────────────────────────────────

export async function acceptSession(session: LocalSession, repoRoot: string): Promise<void> {
  killDevServer(session);

  // Remove the worktree directory (--force handles any leftover uncommitted state)
  await runGit(['worktree', 'remove', '--force', session.worktreePath], repoRoot);

  // Merge the preview branch into the current branch (expected to be main)
  const mergeResult = await runGit(
    ['merge', session.branch, '--no-ff', '-m', `chore: merge local preview ${session.branch}`],
    repoRoot,
  );
  if (mergeResult.code !== 0) {
    throw new Error(`git merge failed:\n${mergeResult.stderr}`);
  }

  // Clean up the preview branch
  await runGit(['branch', '-d', session.branch], repoRoot);

  sessions.delete(session.id);
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export async function rejectSession(session: LocalSession, repoRoot: string): Promise<void> {
  killDevServer(session);
  await runGit(['worktree', 'remove', '--force', session.worktreePath], repoRoot);
  // Force-delete since the branch was never merged
  await runGit(['branch', '-D', session.branch], repoRoot);
  sessions.delete(session.id);
}
