// lib/local-evolve-sessions.ts
// Shared in-memory state for the local evolve flow.
// Module-level singleton — shared across all API routes within the same
// Next.js dev server process. Only used when NODE_ENV=development.

import { query } from '@anthropic-ai/claude-agent-sdk';
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
  /** Formatted markdown progress string for display in the chat. */
  progressText: string;
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

// ─── Progress logging ─────────────────────────────────────────────────────────

export function appendProgress(session: LocalSession, text: string): void {
  session.progressText += text;
  // Cap at 100 KB to avoid unbounded memory growth
  if (session.progressText.length > 100_000) {
    session.progressText = '[…earlier output truncated…]\n' + session.progressText.slice(-90_000);
  }
}

// ─── Tool use summarizer ──────────────────────────────────────────────────────

function summarizeToolUse(name: string, input: Record<string, unknown>): string {
  const filePath = String(input.file_path ?? input.path ?? '');
  const command = String(input.command ?? '');
  const pattern = String(input.pattern ?? '');
  switch (name) {
    case 'Read':      return `Read \`${filePath}\``;
    case 'Write':     return `Write \`${filePath}\``;
    case 'Edit':      return `Edit \`${filePath}\``;
    case 'Glob':      return `Glob \`${pattern}\``;
    case 'Grep':      return `Grep \`${pattern}\``;
    case 'Bash':      return `Bash \`${command.slice(0, 80)}\``;
    case 'TodoWrite': return `Update todo list`;
    case 'Agent':     return `Spawn sub-agent`;
    default:          return name;
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

// ─── Main flow ────────────────────────────────────────────────────────────────

export async function startLocalEvolve(
  session: LocalSession,
  taskRequest: string,
  repoRoot: string,
): Promise<void> {
  // Step 1 — Create a new git worktree on a fresh branch
  appendProgress(session, `- [ ] Creating worktree \`${session.branch}\`…\n`);

  // Record the current branch so the preview instance can merge back into it.
  const parentBranchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  const parentBranch = parentBranchResult.stdout.trim() || 'main';

  const wtResult = await runGit(
    ['worktree', 'add', session.worktreePath, '-b', session.branch],
    repoRoot,
  );
  if (wtResult.code !== 0) {
    throw new Error(`git worktree add failed:\n${wtResult.stderr}`);
  }

  // Store parent branch in git config so the preview's manage endpoint can find it.
  await runGit(['config', `branch.${session.branch}.parent`, parentBranch], repoRoot);

  // Mark done by replacing the pending item
  session.progressText = session.progressText.replace(
    `- [ ] Creating worktree \`${session.branch}\`…`,
    `- [x] Worktree created on branch \`${session.branch}\``,
  );

  // Step 2 — Symlink node_modules to avoid a full npm install (saves minutes)
  const srcMods = path.join(repoRoot, 'node_modules');
  const dstMods = path.join(session.worktreePath, 'node_modules');
  if (fs.existsSync(srcMods) && !fs.existsSync(dstMods)) {
    fs.symlinkSync(srcMods, dstMods, 'junction');
    appendProgress(session, `- [x] Symlinked \`node_modules\`\n`);
  }

  // Step 3 — Symlink .env.local so the preview server has the same credentials
  const srcEnv = path.join(repoRoot, '.env.local');
  const dstEnv = path.join(session.worktreePath, '.env.local');
  if (fs.existsSync(srcEnv) && !fs.existsSync(dstEnv)) {
    fs.symlinkSync(srcEnv, dstEnv);
    appendProgress(session, `- [x] Symlinked \`.env.local\`\n`);
  }

  // Step 4 — Run Claude Code via the Agent SDK
  session.status = 'running-claude';
  appendProgress(session, `\n### 🤖 Claude Code\n\n`);

  const prompt =
    `Read PRIMORDIA.md first for architecture context, then implement the following change:\n\n` +
    `${taskRequest}\n\n` +
    `After making changes:\n` +
    `1. Update the Changelog section of PRIMORDIA.md with a brief entry.\n` +
    `2. Commit all changes with a descriptive message.`;

  const run = query({
    prompt,
    options: {
      cwd: session.worktreePath,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    },
  });

  for await (const message of run) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          appendProgress(session, block.text.trimEnd() + '\n\n');
        } else if (block.type === 'tool_use') {
          const summary = summarizeToolUse(block.name, block.input as Record<string, unknown>);
          appendProgress(session, `- 🔧 ${summary}\n`);
        }
      }
    } else if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new Error(`Claude Code run ended with: ${message.subtype}`);
      }
    }
  }

  appendProgress(session, `\n✅ **Claude Code finished.**\n`);

  // Step 5 — Start Next.js dev server on an available port
  session.status = 'starting-server';
  const port = await findAvailablePort(3001);
  session.port = port;
  appendProgress(session, `\n### 🚀 Starting preview server on port ${port}…\n\n`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('npm', ['run', 'dev'], {
      cwd: session.worktreePath,
      env: { ...process.env, PORT: port.toString(), PREVIEW_BRANCH: session.branch },
      // detached=true creates a new process group so we can kill the entire tree
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // unref so this child doesn't prevent the parent event loop from exiting
    proc.unref();
    session.devServerProcess = proc;

    const onData = (d: Buffer) => {
      const text = d.toString();
      appendProgress(session, text);
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

  appendProgress(session, `\n✅ **Ready at http://localhost:${port}**\n`);
}

// ─── Kill dev server ──────────────────────────────────────────────────────────

export function killDevServer(session: LocalSession): void {
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
