// lib/evolve-sessions.ts
// Helpers for the local evolve flow.
// Only used when NODE_ENV=development.

import { query, type HookCallback, type PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getDb } from './db';
import { isGatewayAvailable } from './llm-client';

const GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/anthropic';

/**
 * Returns env vars to inject into the Claude Code CLI subprocess so it routes
 * through the exe.dev LLM gateway instead of calling Anthropic directly.
 * Returns an empty object when the gateway is not available (falls back to
 * whatever ANTHROPIC_API_KEY is set in the process environment).
 */
async function getGatewayEnv(): Promise<Record<string, string>> {
  if (await isGatewayAvailable()) {
    return {
      ANTHROPIC_BASE_URL: GATEWAY_BASE_URL,
    };
  }
  return {};
}

export type LocalSessionStatus =
  | 'starting'
  | 'running-claude'
  | 'fixing-types'
  | 'ready'
  | 'accepted'
  | 'rejected'
  | 'error';

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
  /** Formatted markdown progress string for display in the chat. */
  progressText: string;
  port: number | null;
  previewUrl: string | null;
  /** The original change request text submitted by the user. */
  request: string;
  /** Unix timestamp (ms) when the session was created. */
  createdAt: number;
}

// ─── In-memory dev server registry ───────────────────────────────────────────

/**
 * Maps session IDs to their active dev server ChildProcess.
 * Used by inferDevServerStatus to return 'starting' when the process is live
 * but hasn't yet reported its port.
 */
const activeDevServerProcesses = new Map<string, ChildProcess>();

// ─── In-memory Claude abort controller registry ───────────────────────────────

/**
 * Maps session IDs to the AbortController for any currently-running Claude
 * Code query() call. Populated by startLocalEvolve / runFollowupInWorktree
 * and cleared when the query finishes (normally, timeout, or abort).
 */
const activeClaudeAbortControllers = new Map<string, AbortController>();

/**
 * Signals the running Claude Code instance for the given session to stop.
 * Returns true if an active controller was found and aborted, false if the
 * session has no running Claude Code instance.
 */
export function abortClaudeRun(sessionId: string): boolean {
  const controller = activeClaudeAbortControllers.get(sessionId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/**
 * Infers the current DevServerStatus without reading it from SQLite.
 *
 * Strategy:
 *  - port === null and process registered → 'starting' (spawned, port not yet known)
 *  - port === null and no process          → 'none'    (server not yet started)
 *  - port set, lsof finds a listener      → 'running'
 *  - port set, lsof finds nothing         → 'disconnected'
 */
export function inferDevServerStatus(sessionId: string, port: number | null): DevServerStatus {
  if (port === null) {
    const proc = activeDevServerProcesses.get(sessionId);
    if (proc && !proc.killed) return 'starting';
    return 'none';
  }
  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    execSync(`lsof -ti :${port}`, { stdio: ['pipe', 'pipe', 'pipe'] });
    return 'running';
  } catch {
    return 'disconnected';
  }
}

// ─── Progress logging ─────────────────────────────────────────────────────────

export function appendProgress(session: LocalSession, text: string): void {
  session.progressText += text;
  // Cap at 100 KB to avoid unbounded memory growth
  if (session.progressText.length > 100_000) {
    session.progressText = '[…earlier output truncated…]\n' + session.progressText.slice(-90_000);
  }
}

// ─── Session context extractor ────────────────────────────────────────────────

/**
 * Parses accumulated progressText to extract the text of every previous
 * follow-up request. Returned in submission order so the follow-up prompt
 * can list them as numbered prior requests.
 *
 * Matches the literal format written by runFollowupInWorktree:
 *   ### 🔄 Follow-up Request\n\n> {request}\n\n### 🤖 Claude Code
 */
function extractPriorFollowupRequests(progressText: string): string[] {
  const results: string[] = [];
  const regex = /### 🔄 Follow-up Request\n\n> ([\s\S]*?)\n\n### 🤖 Claude Code/g;
  let match;
  while ((match = regex.exec(progressText)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

// ─── Tool use summarizer ──────────────────────────────────────────────────────

function summarizeToolUse(
  name: string,
  input: Record<string, unknown>,
  worktreePath: string = '',
): string {
  const rawFilePath = String(input.file_path ?? input.path ?? '');
  const command = String(input.command ?? '');
  const pattern = String(input.pattern ?? '');

  // Replace the absolute worktree prefix with "./" for readability.
  const shortenPath = (p: string): string => {
    if (!worktreePath || !p) return p;
    const prefix = worktreePath.endsWith(path.sep) ? worktreePath : worktreePath + path.sep;
    if (p === worktreePath) return '.';
    if (p.startsWith(prefix)) return './' + p.slice(prefix.length);
    return p;
  };

  const filePath = shortenPath(rawFilePath);

  switch (name) {
    case 'Read':      return `Read \`${filePath}\``;
    case 'Write':     return `Write \`${filePath}\``;
    case 'Edit':      return `Edit \`${filePath}\``;
    case 'Glob':      return `Glob \`${pattern}\``;
    case 'Grep':      return `Grep \`${pattern}\``;
    case 'Bash':      return `Bash \`${command.replace(/\r?\n/g, ' ')}\``;
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

    // Bash — block commands that explicitly reference the main repo root.
    // We use a regex with a lookahead instead of a plain `includes()` to avoid
    // false positives when repoRootNorm is a string prefix of a worktree path
    // (e.g. `/…/primordia` must not match `/…/primordia-worktrees/…`).
    // The lookahead requires the match to be followed by /, whitespace, a quote,
    // or end-of-string — i.e. it must appear as a path component, not a prefix.
    if (toolName === 'Bash') {
      const command = typeof toolInput.command === 'string' ? toolInput.command : '';
      const escaped = repoRootNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(escaped + '(?=[/\\s"\'`]|$)').test(command)) {
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
  /** Public hostname (no port) to use when constructing preview URLs.
   *  Comes from the x-forwarded-host request header so the URL is correct
   *  when running behind a reverse proxy (e.g. exe.dev). Defaults to "localhost". */
  publicHostname: string = "localhost",
  /** Temporary file paths for user-uploaded attachments. Copied into worktree/attachments/ and deleted from /tmp. */
  attachmentPaths: string[] = [],
): Promise<void> {
  const db = await getDb();

  /** Write the current session state to SQLite. */
  const persist = () =>
    db.updateEvolveSession(session.id, {
      status: session.status,
      progressText: session.progressText,
      port: session.port,
      previewUrl: session.previewUrl,
    });

  // Holds the spawned dev-server process so the close/cleanup callback can
  // reference it without exposing it on the session object.
  let devServerProcess: ChildProcess | null = null;

  try {
    // Log which LLM backend is active so the user can see it in the session log.
    const usingGateway = await isGatewayAvailable();
    appendProgress(
      session,
      `- [x] Determine LLM source: ${usingGateway ? 'exe.dev gateway' : 'ANTHROPIC_API_KEY'}\n`,
    );

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

    // Store parent branch and session ID in git config so the preview's manage
    // endpoint can find them when logging the accept/reject decision back to the
    // parent instance's SQLite database.
    await runGit(['config', `branch.${session.branch}.parent`, parentBranch], repoRoot);
    await runGit(['config', `branch.${session.branch}.sessionId`, session.id], repoRoot);

    // Mark done by replacing the pending item
    session.progressText = session.progressText.replace(
      `- [ ] Creating worktree \`${session.branch}\`…`,
      `- [x] Worktree created on branch \`${session.branch}\``,
    );
    await persist();

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
          void persist();
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

      // Delete this session from the copied DB so the child worktree doesn't
      // start with an incomplete in-progress session visible in its history.
      // The copy was taken mid-session (after "creating worktree" and "bun install"
      // were already logged), so the row is confusing noise in the child instance.
      try {
        const { Database } = await import('bun:sqlite');
        const childDb = new Database(dstDb);
        childDb.prepare('DELETE FROM evolve_sessions WHERE id = ?').run(session.id);
        childDb.close();
      } catch {
        // Non-fatal — the child worktree will just have a stale partial session.
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
      appendProgress(session, `- [x] Copied ${worktreeAttachmentPaths.length} attachment(s) into worktree\n`);
    }

    // Step 6 — Run Claude Code via the Agent SDK
    session.status = 'running-claude';
    appendProgress(session, `\n### 🤖 Claude Code\n\n`);
    await persist();

    const attachmentSection = worktreeAttachmentPaths.length > 0
      ? `\n\nThe user has attached the following file(s) to this request (already saved in the worktree):\n` +
        worktreeAttachmentPaths.map(p => `- \`${p}\``).join('\n') +
        `\n\nRead and use these files as needed. If they are images or assets that should be added to the project, copy them to an appropriate location (e.g., \`public/\`) with a descriptive filename.`
      : '';

    const prompt =
      `Read PRIMORDIA.md first for architecture context, then implement the following change:\n\n` +
      `${taskRequest}${attachmentSection}\n\n` +
      `After making changes:\n` +
      `1. Create a new changelog file in the \`changelog/\` directory named \`YYYY-MM-DD-HH-MM-SS Description of change.md\` (UTC time, e.g. \`2026-03-16-21-00-00 Fix login bug.md\`). The filename is the short description; the file body is the full "what changed + why" detail in markdown. Do NOT add changelog entries to PRIMORDIA.md itself.\n` +
      `2. Commit all changes with a descriptive message.`;

    // Accumulate stderr lines so they can be surfaced if the process crashes.
    const stderrLines: string[] = [];

    // 20-minute timeout: abort Claude Code and fall through to "ready" state.
    const claudeAbortController = new AbortController();
    let claudeTimedOut = false;
    let claudeUserAborted = false;
    const claudeTimeoutId = setTimeout(() => {
      claudeTimedOut = true;
      claudeAbortController.abort();
    }, 20 * 60 * 1000);

    activeClaudeAbortControllers.set(session.id, claudeAbortController);

    const run = query({
      prompt,
      options: {
        cwd: session.worktreePath,
        env: await getGatewayEnv(),
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `The current working directory is: ${session.worktreePath}`,
        },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController: claudeAbortController,
        // Capture stderr from the Claude Code process. Claude Code writes
        // diagnostic/crash information to stderr before exiting with a non-zero
        // code, so capturing it gives much better error messages than just the
        // exit code alone.
        stderr: (data: string) => {
          stderrLines.push(data.trimEnd());
        },
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

    try {
      for await (const message of run) {
        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text.trim()) {
              // If the previous content ended a list (single trailing newline), add
              // a blank line so the list renders correctly in markdown.
              if (session.progressText.endsWith('\n') && !session.progressText.endsWith('\n\n')) {
                appendProgress(session, '\n');
              }
              appendProgress(session, block.text.trimEnd() + '\n\n');
            } else if (block.type === 'tool_use') {
              const summary = summarizeToolUse(block.name, block.input as Record<string, unknown>, session.worktreePath);
              appendProgress(session, `- 🔧 ${summary}\n`);
            }
          }
          // Write live progress to SQLite so the session page stays up to date.
          await persist();
        } else if (message.type === 'result') {
          if (message.subtype !== 'success') {
            // `errors` is populated by the SDK when subtype is e.g. error_during_execution.
            const sdkErrors = (message as { errors?: string[] }).errors ?? [];
            const stderrStr = stderrLines.join('\n').trim();
            const details = [
              sdkErrors.filter(Boolean).join('\n'),
              stderrStr,
            ].filter(Boolean).join('\n');
            throw new Error(
              `Claude Code run ended with: ${message.subtype}` +
              (details ? `\n\nDetails:\n${details}` : ''),
            );
          }
        }
      }
    } catch (err) {
      // If the abort was triggered by our timeout or by the user, swallow the
      // error and fall through to start the dev server with whatever work was completed.
      claudeUserAborted = !claudeTimedOut && claudeAbortController.signal.aborted;
      if (claudeTimedOut) {
        appendProgress(session, `\n\n⏱️ **Claude Code timed out after 20 minutes.** Moving to ready state with work completed so far.\n`);
        await persist();
      } else if (claudeUserAborted) {
        appendProgress(session, `\n\n🛑 **Claude Code was aborted.** Moving to ready state with work completed so far.\n`);
        await persist();
      } else {
        // If this is a process-level failure (e.g. "Claude Code process exited with code 1")
        // rather than the structured error we threw above, enrich it with any captured stderr.
        const stderrStr = stderrLines.join('\n').trim();
        if (
          stderrStr &&
          err instanceof Error &&
          !err.message.includes('Details:') // not our own structured error
        ) {
          throw new Error(`${err.message}\n\nStderr:\n${stderrStr}`, { cause: err });
        }
        throw err;
      }
    } finally {
      clearTimeout(claudeTimeoutId);
      activeClaudeAbortControllers.delete(session.id);
    }

    if (!claudeTimedOut && !claudeUserAborted) {
      appendProgress(session, `\n✅ **Claude Code finished.**\n`);
      await persist();
    }

    // Step 6 — Start Next.js dev server and detect the port from its output.
    // We let Next.js pick its own port (defaulting to 3000, or the next available
    // port if 3000 is busy) rather than pre-finding a free port ourselves. This
    // avoids a race condition between our port check and Next.js binding. We parse
    // two possible output patterns to discover which port was chosen:
    //   "- Local:        http://localhost:3002"
    //   "⚠ Port 3000 is in use by process 85352, using available port 3002 instead."
    session.status = 'ready';
    session.devServerStatus = 'starting';
    appendProgress(session, `\n### 🚀 Starting preview server…\n\n`);
    await persist();

    await new Promise<void>((resolve, reject) => {
      // omit the PORT env var so Next.js can pick an available port
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { PORT, ...envWithoutPort } = process.env;
      const proc = spawn('bun', ['run', 'dev'], {
        cwd: session.worktreePath,
        env: { ...envWithoutPort, NODE_ENV: 'development' },
        // detached=true creates a new process group so we can kill the entire tree
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      // unref so this child doesn't prevent the parent event loop from exiting
      proc.unref();
      devServerProcess = proc;
      activeDevServerProcesses.set(session.id, proc);

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

        // Next.js 16 prints "Ready" when the dev server is up
        if (!session.previewUrl && session.port !== null && text.includes('Ready')) {
          session.previewUrl = `http://${publicHostname}:${session.port}`;
          session.devServerStatus = 'running';
          void persist();
          resolve();
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.on('error', (err) => reject(new Error(`Dev server spawn failed: ${err.message}`)));
      proc.on('close', (code) => {
        activeDevServerProcesses.delete(session.id);
        if (session.devServerStatus !== 'running') {
          reject(new Error(`Dev server exited (code ${code ?? 'unknown'}) before becoming ready`));
          return;
        }

        // The dev server has terminated after having been ready. This happens when
        // the preview was accepted or rejected (manage/route.ts calls process.exit),
        // when the server was killed manually, or when it crashed.
        //
        // Wait a few seconds for any in-flight git cleanup (worktree remove, branch
        // delete) to complete, then check whether the branch still exists:
        //   - Branch gone  → normal accept/reject flow; nothing to update.
        //   - Branch exists → unexpected termination (crashed / killed manually);
        //                     mark session as disconnected so the UI can inform the user.
        setTimeout(() => {
          void (async () => {
            try {
              devServerProcess = null;
              const branchCheck = await runGit(['branch', '--list', session.branch], repoRoot);
              if (branchCheck.stdout.trim() !== '') {
                // Branch still exists → server died unexpectedly.
                session.devServerStatus = 'disconnected';
              }
              // Branch gone → accept/reject completed normally; no update needed.
            } catch {
              // If git fails for any reason, fall back to marking disconnected.
              session.devServerStatus = 'disconnected';
              devServerProcess = null;
            }
          })();
        }, 3_000);
      });

      // Safety timeout: 2 minutes
      setTimeout(() => {
        if (session.devServerStatus !== 'running') {
          reject(new Error('Dev server startup timed out (2 min)'));
        }
      }, 120_000);
    });

    appendProgress(session, `\n✅ **Ready on port ${session.port}**\n`);
    await persist();

  } catch (err) {
    // Write error state to SQLite so the session page shows the failure.
    session.status = 'error';
    const msg = err instanceof Error ? err.message : String(err);
    const causeMsg =
      err instanceof Error && err.cause instanceof Error
        ? `\n\n*Caused by*: ${err.cause.message}`
        : '';
    appendProgress(session, `\n\n❌ **Error**: ${msg}${causeMsg}\n`);
    await persist().catch(() => {});
    // Kill the dev server process if it was spawned before the error.
    // Capture in a local const first: TypeScript cannot track the ChildProcess | null
    // type of devServerProcess across async callbacks, so it narrows to `never` here.
    const orphanProc = devServerProcess as ChildProcess | null;
    if (orphanProc && !orphanProc.killed) {
      try {
        if (orphanProc.pid !== undefined) {
          process.kill(-orphanProc.pid, 'SIGTERM');
        }
      } catch {
        orphanProc.kill('SIGTERM');
      }
      devServerProcess = null;
    }
  }
}

// ─── Follow-up request ────────────────────────────────────────────────────────

/**
 * Runs a follow-up Claude Code pass inside an existing worktree.
 * The dev server keeps running; this function only re-invokes Claude and
 * persists the result. Status transitions: ready → running-claude → ready | error.
 *
 * @param onSuccess - Optional callback invoked (instead of setting status to 'ready') when Claude
 *   finishes successfully. The callback is responsible for persisting the final session status.
 *   Used by the type-fix flow to retry Accept server-side without requiring the client tab to be open.
 * @param skipChangelog - When true, instructs Claude NOT to create or update changelog files.
 *   Use for automated fix passes (e.g. type-fix) that are part of the merge pipeline, not
 *   user-visible changes.
 */
export async function runFollowupInWorktree(
  session: LocalSession,
  followupRequest: string,
  repoRoot: string,
  /** Status to persist while Claude is running. Defaults to 'running-claude'. */
  inProgressStatus: LocalSessionStatus = 'running-claude',
  onSuccess?: (session: LocalSession) => Promise<void>,
  skipChangelog: boolean = false,
  /** Temporary file paths for user-uploaded attachments. Copied into worktree/attachments/ and deleted from /tmp. */
  attachmentPaths: string[] = [],
): Promise<void> {
  const db = await getDb();

  const persist = () =>
    db.updateEvolveSession(session.id, {
      status: session.status,
      progressText: session.progressText,
      port: session.port,
      previewUrl: session.previewUrl,
    });

  try {
    if (skipChangelog) {
      // Type-fix passes get their own section heading instead of the user-facing follow-up format.
      appendProgress(session, `\n\n---\n\n### 🔧 Fixing type errors…\n\n`);
    } else {
      appendProgress(
        session,
        `\n\n---\n\n### 🔄 Follow-up Request\n\n> ${followupRequest}\n\n### 🤖 Claude Code\n\n`,
      );
    }
    session.status = inProgressStatus;
    await persist();

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

    // Build a session context block so Claude knows the original request, any
    // prior follow-ups, and what has already been committed. Without this,
    // short follow-ups like "retry" give Claude no way to know what to retry.
    // Skip for skipChangelog (type-fix) passes — they don't need this context.
    let sessionContextSection = '';
    if (!skipChangelog) {
      const priorFollowups = extractPriorFollowupRequests(session.progressText);

      // Commits made so far in this session only (exclude parent-branch history).
      const parentConfigResult = await runGit(
        ['config', `branch.${session.branch}.parent`],
        session.worktreePath,
      );
      const parentBranch = parentConfigResult.stdout.trim();
      const logArgs = parentBranch
        ? ['log', '--oneline', `${parentBranch}..HEAD`]
        : ['log', '--oneline', '-10'];
      const logResult = await runGit(logArgs, session.worktreePath);
      const gitLog = logResult.stdout.trim() || '(no commits yet in this session)';

      const contextLines: string[] = [
        '---',
        '',
        '**Context from this evolve session:**',
        '',
        `**Original request:** ${session.request}`,
        '',
      ];
      if (priorFollowups.length > 0) {
        contextLines.push('**Previous follow-up requests in this session:**');
        priorFollowups.forEach((req, i) => {
          contextLines.push(`${i + 1}. ${req}`);
        });
        contextLines.push('');
      }
      contextLines.push('**Commits made so far in this session:**');
      contextLines.push('```');
      contextLines.push(gitLog);
      contextLines.push('```');
      contextLines.push('');
      contextLines.push('---');
      contextLines.push('');
      sessionContextSection = contextLines.join('\n');
    }

    const prompt =
      `Read PRIMORDIA.md first for architecture context, then address the following follow-up request:\n\n` +
      `${sessionContextSection}` +
      `**Follow-up request:**\n\n${followupRequest}${attachmentSection}\n\n` +
      `${changelogInstruction} Commit all changes with a descriptive message.`;

    const stderrLines: string[] = [];

    // 20-minute timeout: abort Claude Code and fall through to "ready" state.
    const claudeAbortController = new AbortController();
    let claudeTimedOut = false;
    let claudeUserAborted = false;
    const claudeTimeoutId = setTimeout(() => {
      claudeTimedOut = true;
      claudeAbortController.abort();
    }, 20 * 60 * 1000);

    activeClaudeAbortControllers.set(session.id, claudeAbortController);

    const run = query({
      prompt,
      options: {
        cwd: session.worktreePath,
        env: await getGatewayEnv(),
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `The current working directory is: ${session.worktreePath}`,
        },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController: claudeAbortController,
        stderr: (data: string) => {
          stderrLines.push(data.trimEnd());
        },
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

    try {
      for await (const message of run) {
        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text.trim()) {
              if (session.progressText.endsWith('\n') && !session.progressText.endsWith('\n\n')) {
                appendProgress(session, '\n');
              }
              appendProgress(session, block.text.trimEnd() + '\n\n');
            } else if (block.type === 'tool_use') {
              const summary = summarizeToolUse(block.name, block.input as Record<string, unknown>, session.worktreePath);
              appendProgress(session, `- 🔧 ${summary}\n`);
            }
          }
          await persist();
        } else if (message.type === 'result') {
          if (message.subtype !== 'success') {
            const sdkErrors = (message as { errors?: string[] }).errors ?? [];
            const stderrStr = stderrLines.join('\n').trim();
            const details = [
              sdkErrors.filter(Boolean).join('\n'),
              stderrStr,
            ].filter(Boolean).join('\n');
            throw new Error(
              `Claude Code run ended with: ${message.subtype}` +
              (details ? `\n\nDetails:\n${details}` : ''),
            );
          }
        }
      }
    } catch (err) {
      claudeUserAborted = !claudeTimedOut && claudeAbortController.signal.aborted;
      if (claudeTimedOut) {
        appendProgress(session, `\n\n⏱️ **Claude Code timed out after 20 minutes.** Moving to ready state with work completed so far.\n`);
        session.status = 'ready';
        await persist();
        return;
      }
      if (claudeUserAborted) {
        appendProgress(session, `\n\n🛑 **Claude Code was aborted.** Moving to ready state with work completed so far.\n`);
        session.status = 'ready';
        await persist();
        return;
      }
      const stderrStr = stderrLines.join('\n').trim();
      if (
        stderrStr &&
        err instanceof Error &&
        !err.message.includes('Details:')
      ) {
        throw new Error(`${err.message}\n\nStderr:\n${stderrStr}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(claudeTimeoutId);
      activeClaudeAbortControllers.delete(session.id);
    }

    if (onSuccess) {
      await onSuccess(session);
    } else {
      appendProgress(session, `\n✅ **Follow-up complete. Preview server will reload automatically.**\n`);
      session.status = 'ready';
      await persist();
    }
  } catch (err) {
    session.status = 'error';
    const msg = err instanceof Error ? err.message : String(err);
    const causeMsg =
      err instanceof Error && err.cause instanceof Error
        ? `\n\n*Caused by*: ${err.cause.message}`
        : '';
    appendProgress(session, `\n\n❌ **Error**: ${msg}${causeMsg}\n`);
    await persist().catch(() => {});
  }
}

// ─── Restart dev server ───────────────────────────────────────────────────────

/**
 * Kills any process listening on the session's port (if any), then re-spawns
 * `bun run dev` in the worktree on the same port.
 *
 * Status transitions: (any) → starting-server → ready | error.
 * Reconnects the close-watcher so the session is marked "disconnected" again
 * if the restarted server exits unexpectedly.
 */
export async function restartDevServerInWorktree(
  session: LocalSession,
  repoRoot: string,
  /** Public hostname (no port) for preview URLs. Defaults to "localhost". */
  publicHostname: string = "localhost",
): Promise<void> {
  const db = await getDb();

  const persist = () =>
    db.updateEvolveSession(session.id, {
      status: session.status,
      progressText: session.progressText,
      port: session.port,
      previewUrl: session.previewUrl,
    });

  try {
    appendProgress(session, `\n### 🔄 Restarting preview server…\n\n`);

    // Save the old port so we can pass it to the new process and kill any
    // existing listener. Reset session.port to null now so that
    // inferDevServerStatus returns 'starting' (via the process map) rather
    // than 'disconnected' (via lsof) during the restart window.
    const oldPort = session.port;
    session.port = null;
    session.previewUrl = null;
    await persist();

    // Kill the existing dev server process group. Turbopack spawns worker processes
    // that don't bind to the port, so killing by port alone (lsof) leaves orphans
    // that block a clean restart. Killing the process group via the negative PID
    // takes down the entire tree in one shot.
    const existingProc = activeDevServerProcesses.get(session.id);
    if (existingProc && !existingProc.killed && existingProc.pid !== undefined) {
      try { process.kill(-existingProc.pid, 'SIGTERM'); } catch { /* already dead */ }
      activeDevServerProcesses.delete(session.id);
    }

    // Belt-and-suspenders: also kill any process still binding to the port in case
    // the in-memory reference is stale (e.g. the parent server restarted since the
    // worktree was spawned).
    if (oldPort !== null) {
      try {
        const { execSync } = await import('child_process');
        const raw = execSync(`lsof -ti :${oldPort}`, { encoding: 'utf8' }).trim();
        const pids = raw.split('\n').map((p) => p.trim()).filter(Boolean);
        for (const pid of pids) {
          try { process.kill(parseInt(pid, 10), 'SIGTERM'); } catch { /* already dead */ }
        }
      } catch {
        // lsof not available or no process on port — proceed anyway.
      }
    }

    // Give the OS a moment to release the port before rebinding.
    if (existingProc || oldPort !== null) {
      await new Promise<void>((r) => setTimeout(r, 800));
    }

    session.devServerStatus = 'starting';

    await new Promise<void>((resolve, reject) => {
      // Pass PORT so Next.js reuses the same port rather than hunting for a free one.
      const { PORT: _omit, ...envWithoutPort } = process.env;
      const env =
        oldPort !== null
          ? { ...envWithoutPort, NODE_ENV: 'development' as const, PORT: String(oldPort) }
          : { ...envWithoutPort, NODE_ENV: 'development' as const };

      const proc = spawn('bun', ['run', 'dev'], {
        cwd: session.worktreePath,
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as ChildProcess;
      proc.unref();
      activeDevServerProcesses.set(session.id, proc);

      const onData = (d: Buffer) => {
        const text = d.toString();
        appendProgress(session, text);

        // Re-detect port in case it changed (e.g. original port was reclaimed).
        if (session.port === null) {
          const portMatch =
            text.match(/localhost:(\d+)/) ??
            text.match(/using available port (\d+) instead/i);
          if (portMatch) {
            session.port = parseInt(portMatch[1], 10);
          }
        }

        if (!session.previewUrl && session.port !== null && text.includes('Ready')) {
          session.previewUrl = `http://${publicHostname}:${session.port}`;
          session.devServerStatus = 'running';
          void persist();
          resolve();
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.on('error', (err) => reject(new Error(`Dev server spawn failed: ${err.message}`)));
      proc.on('close', (code) => {
        activeDevServerProcesses.delete(session.id);
        if (session.devServerStatus !== 'running') {
          reject(new Error(`Dev server exited (code ${code ?? 'unknown'}) before becoming ready`));
          return;
        }
        // Server exited after being ready — same disconnect detection as startLocalEvolve.
        setTimeout(() => {
          void (async () => {
            try {
              const branchCheck = await runGit(['branch', '--list', session.branch], repoRoot);
              if (branchCheck.stdout.trim() !== '') {
                session.devServerStatus = 'disconnected';
              }
            } catch {
              session.devServerStatus = 'disconnected';
            }
          })();
        }, 3_000);
      });

      // Safety timeout: 2 minutes
      setTimeout(() => {
        if (session.devServerStatus !== 'running') {
          reject(new Error('Dev server startup timed out (2 min)'));
        }
      }, 120_000);
    });

    appendProgress(session, `\n✅ **Ready on port ${session.port}**\n`);
    await persist();
  } catch (err) {
    session.status = 'error';
    const msg = err instanceof Error ? err.message : String(err);
    appendProgress(session, `\n\n❌ **Error**: ${msg}\n`);
    await persist().catch(() => {});
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
        env: await getGatewayEnv(),
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
            const summary = summarizeToolUse(block.name, block.input as Record<string, unknown>, mergeRoot);
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

