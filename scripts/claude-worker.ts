// scripts/claude-worker.ts
// Standalone Claude Code worker process. Spawned by the app server as a
// detached child so it survives server restarts.
//
// Usage: bun scripts/claude-worker.ts <config-file>
//
// The config file is a temporary JSON file written by the server.
// It is deleted by the server after the worker exits.
//
// Process lifecycle:
//   • Writes PID to {worktreePath}/.primordia-worker.pid on startup
//   • Deletes the PID file on exit (any exit path)
//   • SIGTERM → graceful abort: Claude is stopped, session marked 'ready'
//   • Timeout  → same effect as SIGTERM
//   • Success  → sets session 'ready' (+ previewUrl) if setReadyOnSuccess=true,
//               otherwise just flushes progress and exits (server calls onSuccess)
//   • Error    → sets session 'ready' with error message

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

interface WorkerConfig {
  sessionId: string;
  worktreePath: string;
  repoRoot: string;
  dbPath: string;
  prompt: string;
  timeoutMs?: number;
  setReadyOnSuccess: boolean;
  completionMessage?: string;
  publicOrigin: string | null;
}

function openDb(dbPath: string) {
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  return db;
}

type Db = ReturnType<typeof openDb>;

function dbGetProgressText(db: Db, sessionId: string): string {
  const row = db
    .prepare('SELECT progress_text FROM evolve_sessions WHERE id = ?')
    .get(sessionId) as { progress_text: string } | null;
  return row?.progress_text ?? '';
}

function dbUpdate(
  db: Db,
  sessionId: string,
  updates: {
    status?: string;
    progressText?: string;
    previewUrl?: string | null;
    durationMs?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    costUsd?: number | null;
  },
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.status !== undefined)       { sets.push('status = ?');        values.push(updates.status); }
  if (updates.progressText !== undefined) { sets.push('progress_text = ?'); values.push(updates.progressText); }
  if (updates.previewUrl !== undefined)   { sets.push('preview_url = ?');   values.push(updates.previewUrl); }
  if (updates.durationMs !== undefined)   { sets.push('duration_ms = ?');   values.push(updates.durationMs); }
  if (updates.inputTokens !== undefined)  { sets.push('input_tokens = ?');  values.push(updates.inputTokens); }
  if (updates.outputTokens !== undefined) { sets.push('output_tokens = ?'); values.push(updates.outputTokens); }
  if (updates.costUsd !== undefined)      { sets.push('cost_usd = ?');      values.push(updates.costUsd); }
  if (sets.length === 0) return;
  values.push(sessionId);
  db.prepare(`UPDATE evolve_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

let progressText = '';

function appendProgress(text: string): void {
  progressText += text;
  if (progressText.length > 100_000) {
    progressText = '[…earlier output truncated…]\n' + progressText.slice(-90_000);
  }
}

function summarizeToolUse(name: string, input: Record<string, unknown>, worktreePath: string): string {
  const rawFilePath = String(input.file_path ?? input.path ?? '');
  const command = String(input.command ?? '');
  const pattern = String(input.pattern ?? '');
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
    case 'Agent': return 'Spawn sub-agent';
    default:       return name;
  }
}

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
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    if (filePath && !isInsideWorktree(filePath)) {
      return {
        decision: 'block' as const,
        reason: `Out-of-worktree access blocked: \`${filePath}\` is outside the worktree at \`${worktreeNorm}\`. Only files within the worktree may be read or modified.`,
      };
    }
    const searchPath = typeof toolInput.path === 'string' ? toolInput.path : '';
    if (searchPath && path.isAbsolute(searchPath) && !isInsideWorktree(searchPath)) {
      return {
        decision: 'block' as const,
        reason: `Out-of-worktree access blocked: search path \`${searchPath}\` is outside the worktree at \`${worktreeNorm}\`.`,
      };
    }
    if (toolName === 'Bash') {
      const command = typeof toolInput.command === 'string' ? toolInput.command : '';
      const escaped = repoRootNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(escaped + '(?=[/\\s"\'`]|$)').test(command)) {
        return {
          decision: 'block' as const,
          reason: `Out-of-worktree access blocked: the Bash command references the main repo root \`${repoRootNorm}\`. Run git commands inside the worktree instead.`,
        };
      }
    }
    return {};
  };
}

async function main(): Promise<void> {
  const configFile = process.argv[2];
  if (!configFile) {
    process.stderr.write('Usage: bun scripts/claude-worker.ts <config-file>\n');
    process.exit(1);
  }

  let config: WorkerConfig;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8')) as WorkerConfig;
  } catch (err) {
    process.stderr.write(`Failed to read config file: ${err}\n`);
    process.exit(1);
  }

  const { sessionId, worktreePath, repoRoot, dbPath, prompt, publicOrigin, setReadyOnSuccess } = config;
  const timeoutMs = config.timeoutMs ?? 20 * 60 * 1000;
  const completionMessage = config.completionMessage ?? '\n✅ **Claude Code finished.**\n';

  const pidFile = path.join(worktreePath, '.primordia-worker.pid');
  try {
    fs.writeFileSync(pidFile, String(process.pid), 'utf8');
  } catch (err) {
    process.stderr.write(`Warning: could not write PID file: ${err}\n`);
  }

  const db = openDb(dbPath);
  progressText = dbGetProgressText(db, sessionId);

  function cleanup(): void {
    try { fs.rmSync(pidFile, { force: true }); } catch { /* best-effort */ }
    try { db.close(); } catch { /* best-effort */ }
  }

  const abortController = new AbortController();
  let timedOut = false;
  let userAborted = false;

  process.on('SIGTERM', () => {
    userAborted = true;
    abortController.abort();
  });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);

  const stderrLines: string[] = [];

  // Usage metrics captured from the SDK result message.
  let capturedDurationMs: number | null = null;
  let capturedInputTokens: number | null = null;
  let capturedOutputTokens: number | null = null;
  let capturedCostUsd: number | null = null;

  function appendMetricsMarker(): void {
    const data: Record<string, number> = {};
    if (capturedDurationMs != null) data.durationMs = capturedDurationMs;
    if (capturedCostUsd != null) data.costUsd = capturedCostUsd;
    if (capturedInputTokens != null) data.inputTokens = capturedInputTokens;
    if (capturedOutputTokens != null) data.outputTokens = capturedOutputTokens;
    if (Object.keys(data).length === 0) return;
    appendProgress(`\n<!-- metrics: ${JSON.stringify(data)} -->\n`);
  }

  try {
    const run = query({
      prompt,
      options: {
        cwd: worktreePath,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `The current working directory is: ${worktreePath}`,
        },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController,
        stderr: (data: string) => {
          stderrLines.push(data.trimEnd());
        },
        hooks: {
          PreToolUse: [
            {
              matcher: 'Read|Write|Edit|Glob|Grep|Bash',
              hooks: [makeWorktreeBoundaryHook(worktreePath, repoRoot)],
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
              if (progressText.endsWith('\n') && !progressText.endsWith('\n\n')) {
                appendProgress('\n');
              }
              appendProgress(block.text.trimEnd() + '\n\n');
            } else if (block.type === 'tool_use') {
              const summary = summarizeToolUse(block.name, block.input as Record<string, unknown>, worktreePath);
              appendProgress(`- 🔧 ${summary}\n`);
            }
          }
          dbUpdate(db, sessionId, { progressText });
        } else if (message.type === 'result') {
          if (message.subtype === 'success') {
            capturedDurationMs = (message as { duration_ms?: number }).duration_ms ?? null;
            capturedCostUsd = (message as { total_cost_usd?: number }).total_cost_usd ?? null;
            const usage = (message as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
            capturedInputTokens = usage?.input_tokens ?? null;
            capturedOutputTokens = usage?.output_tokens ?? null;
          } else {
            const sdkErrors = (message as { errors?: string[] }).errors ?? [];
            const stderrStr = stderrLines.join('\n').trim();
            const details = [sdkErrors.filter(Boolean).join('\n'), stderrStr].filter(Boolean).join('\n');
            throw new Error(
              `Claude Code run ended with: ${message.subtype}` +
              (details ? `\n\nDetails:\n${details}` : ''),
            );
          }
        }
      }
    } catch (err) {
      userAborted = !timedOut && abortController.signal.aborted;
      if (timedOut) {
        appendProgress(`\n\n⏱️ **Claude Code timed out after 20 minutes.** Moving to ready state with work completed so far.\n`);
        appendMetricsMarker();
        dbUpdate(db, sessionId, { status: 'ready', progressText, durationMs: capturedDurationMs, inputTokens: capturedInputTokens, outputTokens: capturedOutputTokens, costUsd: capturedCostUsd });
        clearTimeout(timeoutId);
        cleanup();
        process.exit(0);
      } else if (userAborted) {
        appendProgress(`\n\n🛑 **Claude Code was aborted.** Moving to ready state with work completed so far.\n`);
        appendMetricsMarker();
        dbUpdate(db, sessionId, { status: 'ready', progressText, durationMs: capturedDurationMs, inputTokens: capturedInputTokens, outputTokens: capturedOutputTokens, costUsd: capturedCostUsd });
        clearTimeout(timeoutId);
        cleanup();
        process.exit(0);
      } else {
        const stderrStr = stderrLines.join('\n').trim();
        if (stderrStr && err instanceof Error && !err.message.includes('Details:')) {
          throw new Error(`${err.message}\n\nStderr:\n${stderrStr}`, { cause: err });
        }
        throw err;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    // Successful completion
    const metrics = { durationMs: capturedDurationMs, inputTokens: capturedInputTokens, outputTokens: capturedOutputTokens, costUsd: capturedCostUsd };
    appendMetricsMarker();
    if (setReadyOnSuccess) {
      appendProgress(completionMessage);
      const previewUrl = publicOrigin ? `${publicOrigin}/preview/${sessionId}` : null;
      dbUpdate(db, sessionId, {
        status: 'ready',
        progressText,
        ...(previewUrl !== null ? { previewUrl } : {}),
        ...metrics,
      });
    } else {
      // Leave status unchanged — the server's onSuccess callback handles the transition.
      dbUpdate(db, sessionId, { progressText, ...metrics });
    }

    cleanup();
    process.exit(0);
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    const causeMsg =
      err instanceof Error && err.cause instanceof Error
        ? `\n\n*Caused by*: ${err.cause.message}`
        : '';
    appendProgress(`\n\n❌ **Error**: ${msg}${causeMsg}\n`);
    appendMetricsMarker();
    dbUpdate(db, sessionId, { status: 'ready', progressText, durationMs: capturedDurationMs, inputTokens: capturedInputTokens, outputTokens: capturedOutputTokens, costUsd: capturedCostUsd });
    cleanup();
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Unhandled worker error: ${err}\n`);
  process.exit(1);
});
