// lib/local-evolve-sessions.ts
// Shared in-memory state for the local evolve flow.
// Module-level singleton — shared across all API routes within the same
// Next.js dev server process. Only used when NODE_ENV=development.

import { query, type HookCallback, type PreToolUseHookInput, type SpawnOptions, type SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Custom spawn wrapper passed as `spawnClaudeCodeProcess` to all query() calls.
 *
 * When Next.js runs under bun (`bun run --bun next dev`), child_process.spawn
 * can silently drop empty-string arguments. The Agent SDK passes
 * `--setting-sources ""` (an empty string, from `[].join(",")`) before
 * `--permission-mode bypassPermissions`. When bun drops that empty string,
 * `--permission-mode` becomes the value for `--setting-sources`, producing:
 *   Error processing --setting-sources: Invalid setting source: --permission-mode
 *
 * Filtering empty-string args before spawning prevents the misparse.
 */
function spawnClaudeCode(options: SpawnOptions): SpawnedProcess {
  const filteredArgs = options.args.filter((arg: string) => arg !== '');
  const proc = spawn(options.command, filteredArgs, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'ignore'],
    signal: options.signal,
    env: options.env as Record<string, string | undefined>,
    windowsHide: true,
  });
  return {
    stdin: proc.stdin!,
    stdout: proc.stdout!,
    get killed() { return proc.killed; },
    get exitCode() { return proc.exitCode; },
    kill: proc.kill.bind(proc) as SpawnedProcess['kill'],
    on: proc.on.bind(proc) as SpawnedProcess['on'],
    once: proc.once.bind(proc) as SpawnedProcess['once'],
    off: proc.off.bind(proc) as SpawnedProcess['off'],
  };
}

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

// ─── Worktree boundary enforcement ───────────────────────────────────────────

/**
 * Returns a PreToolUse hook that blocks any file operation whose resolved path
 * falls outside worktreePath. Prevents Claude from accidentally touching the
 * main repo or other worktrees during a local evolve session.
 *
 * Covers:
 *  - Read / Write / Edit  — checked via `file_path`
 *  - Glob / Grep          — checked via `path` (absolute paths only)
 *  - Bash                 — blocks commands that explicitly reference repoRoot
 */
function makeWorktreeBoundaryHook(worktreePath: string, repoRoot: string): HookCallback {
  const worktreeNorm = path.resolve(worktreePath);
  const repoRootNorm = path.resolve(repoRoot);

  function isInsideWorktree(p: string): boolean {
    const resolved = path.resolve(worktreeNorm, p);
    return resolved === worktreeNorm || resolved.startsWith(worktreeNorm + path.sep);
  }

  return async (input) => {
    const hook = input as PreToolUseHookInput;
    const toolInput = hook.tool_input as Record<string, unknown>;
    const toolName = hook.tool_name;

    // Read / Write / Edit — block if file_path resolves outside the worktree
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    if (filePath && !isInsideWorktree(filePath)) {
      return {
        decision: 'block' as const,
        reason:
          `Out-of-worktree access blocked: \`${filePath}\` is outside the worktree at ` +
          `\`${worktreeNorm}\`. Only files within the worktree may be read or modified.`,
      };
    }

    // Glob / Grep — block absolute search paths outside the worktree
    const searchPath = typeof toolInput.path === 'string' ? toolInput.path : '';
    if (searchPath && path.isAbsolute(searchPath) && !isInsideWorktree(searchPath)) {
      return {
        decision: 'block' as const,
        reason:
          `Out-of-worktree access blocked: search path \`${searchPath}\` is outside the ` +
          `worktree at \`${worktreeNorm}\`.`,
      };
    }

    // Bash — block commands that explicitly reference the main repo root
    if (toolName === 'Bash') {
      const command = typeof toolInput.command === 'string' ? toolInput.command : '';
      if (command.includes(repoRootNorm)) {
        return {
          decision: 'block' as const,
          reason:
            `Out-of-worktree access blocked: the Bash command references the main repo root ` +
            `\`${repoRootNorm}\`. Run git commands inside the worktree instead.`,
        };
      }
    }

    return {};
  };
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

  // Step 2 — Run bun install in the worktree.
  // Bun is fast enough that a full install is preferable to a shared symlink,
  // which can cause subtle dependency issues when the worktree diverges.
  appendProgress(session, `- [ ] Running \`bun install\`…\n`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('bun', ['install'], {
      cwd: session.worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.on('close', (code) => {
      if (code === 0) {
        session.progressText = session.progressText.replace(
          '- [ ] Running `bun install`…',
          '- [x] `bun install` complete',
        );
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
    fs.copyFileSync(srcDb, dstDb);
    // Copy WAL and SHM files too if the database is in WAL mode
    for (const ext of ['-shm', '-wal']) {
      const srcExtra = srcDb + ext;
      if (fs.existsSync(srcExtra)) {
        fs.copyFileSync(srcExtra, dstDb + ext);
      }
    }
    appendProgress(session, `- [x] Copied \`${dbName}\` (isolated data branch)\n`);
  }

  // Step 4 — Symlink .env.local so the preview server has the same credentials
  const srcEnv = path.join(repoRoot, '.env.local');
  const dstEnv = path.join(session.worktreePath, '.env.local');
  if (fs.existsSync(srcEnv) && !fs.existsSync(dstEnv)) {
    fs.symlinkSync(srcEnv, dstEnv);
    appendProgress(session, `- [x] Symlinked \`.env.local\`\n`);
  }

  // Step 5 — Run Claude Code via the Agent SDK
  session.status = 'running-claude';
  appendProgress(session, `\n### 🤖 Claude Code\n\n`);

  const prompt =
    `Read PRIMORDIA.md first for architecture context, then implement the following change:\n\n` +
    `${taskRequest}\n\n` +
    `After making changes:\n` +
    `1. Create a new changelog file in the \`changelog/\` directory named \`YYYY-MM-DD-HH-MM-SS Description of change.md\` (UTC time, e.g. \`2026-03-16-21-00-00 Fix login bug.md\`). The filename is the short description; the file body is the full "what changed + why" detail in markdown. Do NOT add changelog entries to PRIMORDIA.md itself.\n` +
    `2. Commit all changes with a descriptive message.`;

  const run = query({
    prompt,
    options: {
      cwd: session.worktreePath,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      spawnClaudeCodeProcess: spawnClaudeCode,
      // Enforce that Claude can only touch files inside the worktree. Without
      // this, Claude Code could (and occasionally did) write directly into the
      // main repo branch instead of the isolated preview worktree.
      hooks: {
        PreToolUse: [
          {
            matcher: 'Read|Write|Edit|Glob|Grep|Bash',
            hooks: [makeWorktreeBoundaryHook(session.worktreePath, repoRoot)],
          },
        ],
      },
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

  // Step 5 — Start Next.js dev server and detect the port from its output.
  // We let Next.js pick its own port (defaulting to 3000, or the next available
  // port if 3000 is busy) rather than pre-finding a free port ourselves. This
  // avoids a race condition between our port check and Next.js binding. We parse
  // two possible output patterns to discover which port was chosen:
  //   "- Local:        http://localhost:3002"
  //   "⚠ Port 3000 is in use by process 85352, using available port 3002 instead."
  session.status = 'starting-server';
  appendProgress(session, `\n### 🚀 Starting preview server…\n\n`);

  await new Promise<void>((resolve, reject) => {
    // omit the PORT env var so Next.js can pick an available port
    const { PORT, ...envWithoutPort } = process.env;
    const proc = spawn('bun', ['run', 'dev'], {
      cwd: session.worktreePath,
      env: envWithoutPort,
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

      // Parse the port from Next.js output if not yet known.
      if (session.port === null) {
        const portMatch =
          text.match(/localhost:(\d+)/) ??
          text.match(/using available port (\d+) instead/i);
        if (portMatch) {
          session.port = parseInt(portMatch[1], 10);
        }
      }

      // Next.js 15 prints "Ready" when the dev server is up
      if (!session.previewUrl && session.port !== null && text.includes('Ready')) {
        session.previewUrl = `http://localhost:${session.port}`;
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

  appendProgress(session, `\n✅ **Ready on port ${session.port}**\n`);
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
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        spawnClaudeCodeProcess: spawnClaudeCode,
      },
    });

    for await (const message of run) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            log += block.text.trimEnd() + '\n\n';
          } else if (block.type === 'tool_use') {
            const summary = summarizeToolUse(block.name, block.input as Record<string, unknown>);
            log += `- 🔧 ${summary}\n`;
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

// ─── Kill dev server ──────────────────────────────────────────────────────────

export function killDevServer(session: LocalSession): void {
  const proc = session.devServerProcess;
  if (!proc || proc.killed) return;
  try {
    // Kill the entire process group (bun + next + its child workers)
    if (proc.pid !== undefined) {
      process.kill(-proc.pid, 'SIGTERM');
    }
  } catch {
    // Fallback: kill just the direct child
    proc.kill('SIGTERM');
  }
  session.devServerProcess = null;
}
