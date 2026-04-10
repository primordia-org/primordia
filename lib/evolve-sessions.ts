// lib/evolve-sessions.ts
// Helpers for the local evolve flow.
// Only used when NODE_ENV=development.

import { query, type HookCallback, type PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getDb } from './db';

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
  /** Formatted markdown progress string for display in the chat. */
  progressText: string;
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
    case 'TodoWrite': {
      const todos = (input.todos as Array<{ content: string; status: string }> | undefined) ?? [];
      if (!todos.length) return 'Update todo list';
      const items = todos.map((t) => {
        const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
        return `${icon} ${t.content}`;
      });
      return `Updated todos: ${items.join(' · ')}`;
    }
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
  /** Public origin (scheme + host, no trailing slash) to use when constructing
   *  preview URLs. Derived from x-forwarded-proto / x-forwarded-host request
   *  headers so the URL is correct behind a reverse proxy (e.g. exe.dev).
   *  Defaults to "http://localhost". */
  publicOrigin: string = "http://localhost",
  /** Temporary file paths for user-uploaded attachments. Copied into worktree/attachments/ and deleted from /tmp. */
  attachmentPaths: string[] = [],
  /** Extra options for advanced use cases. */
  options: {
    /**
     * When true, skip `git worktree add -b <branch>` (branch already exists).
     * Instead runs `git worktree add <path> <branch>` to check out the existing branch.
     */
    skipBranchCreation?: boolean;
  } = {},
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

  try {
    // Step 1 — Create a new git worktree (on a fresh branch, or from an existing one)
    const worktreeLabel = options.skipBranchCreation
      ? `Checking out existing branch \`${session.branch}\` into worktree`
      : `Creating worktree \`${session.branch}\``;
    appendProgress(session, `- [ ] ${worktreeLabel}…\n`);

    // Record the current branch so the preview instance can merge back into it.
    const parentBranchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
    const parentBranch = parentBranchResult.stdout.trim() || 'main';

    // When checking out an existing branch, detect if it's already registered in
    // a worktree (e.g. a previous session left the worktree behind). If so,
    // reuse that worktree path instead of trying to add a new one — git would
    // reject the attempt with "already used by worktree at <path>".
    if (options.skipBranchCreation) {
      const listResult = await runGit(['worktree', 'list', '--porcelain'], repoRoot);
      const existingPath = parseWorktreePathForBranch(listResult.stdout, session.branch);
      if (existingPath) {
        session.worktreePath = existingPath;
        await db.updateEvolveSession(session.id, { worktreePath: existingPath });
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

    // Store parent branch and session ID in git config so the preview's manage
    // endpoint can find them when logging the accept/reject decision back to the
    // parent instance's SQLite database.
    await runGit(['config', `branch.${session.branch}.parent`, parentBranch], repoRoot);
    await runGit(['config', `branch.${session.branch}.sessionId`, session.id], repoRoot);

    // Assign an ephemeral port to this branch in git config (idempotent).
    // The port is stable for the lifetime of the branch and is reused if the
    // server restarts. Preview and production servers both use this port.
    session.port = getOrAssignBranchPort(session.branch, repoRoot);
    await persist();

    // Mark done by replacing the pending item
    session.progressText = session.progressText.replace(
      `- [ ] ${worktreeLabel}…`,
      `- [x] ${worktreeLabel}`,
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

        // Delete this session from the copied DB so the child worktree doesn't
        // start with an incomplete in-progress session visible in its history.
        // The copy was taken mid-session (after "creating worktree" and "bun install"
        // were already logged), so the row is confusing noise in the child instance.
        const childDb = new Database(dstDb);
        childDb.prepare('DELETE FROM evolve_sessions WHERE id = ?').run(session.id);
        childDb.close();
      } catch {
        // Non-fatal — the child worktree will just have a stale partial session.
      }

      appendProgress(session, `- [x] Copied \`${dbName}\` (isolated data branch)\n`);
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
      `Implement the following change:\n\n` +
      `${taskRequest}${attachmentSection}\n\n` +
      `After making changes:\n` +
      `1. Create a new changelog file in the \`changelog/\` directory named \`YYYY-MM-DD-HH-MM-SS Description of change.md\` (UTC time, e.g. \`2026-03-16-21-00-00 Fix login bug.md\`). The filename is the short description; the file body is the full "what changed + why" detail in markdown. Do NOT add changelog entries to CLAUDE.md itself.\n` +
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

    // Step 6 — Mark session ready; the proxy will start the preview server on demand.
    // The preview URL is always accessible through the proxy at /preview/{sessionId}.
    session.previewUrl = `${publicOrigin}/preview/${session.id}`;
    session.status = 'ready';
    await persist();

  } catch (err) {
    // Mark the session ready (with an error note in the log) so the UI shows
    // the failure and allows follow-up requests to retry or recover.
    session.status = 'ready';
    const msg = err instanceof Error ? err.message : String(err);
    const causeMsg =
      err instanceof Error && err.cause instanceof Error
        ? `\n\n*Caused by*: ${err.cause.message}`
        : '';
    appendProgress(session, `\n\n❌ **Error**: ${msg}${causeMsg}\n`);
    await persist().catch(() => {});
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
      `Address the following follow-up request:\n\n` +
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
    session.status = 'ready';
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

