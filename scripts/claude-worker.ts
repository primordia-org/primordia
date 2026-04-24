// scripts/claude-worker.ts
// Standalone Claude Code worker process. Spawned by the app server as a
// detached child so it survives server restarts.
//
// Uses the exe.dev LLM gateway (http://169.254.169.254/gateway/llm/anthropic)
// unconditionally. The gateway handles authentication; no ANTHROPIC_API_KEY is
// required.
//
// Usage: bun scripts/claude-worker.ts <config-file>
//
// Process lifecycle:
//   • Writes PID to {worktreePath}/.primordia-worker.pid on startup
//   • Deletes the PID file on exit (any exit path)
//   • Writes structured events to {worktreePath}/.primordia-session.ndjson
//   • SIGTERM → graceful abort: Claude is stopped, 'aborted' result event written
//   • Timeout  → same effect as SIGTERM
//   • Success  → 'success' result event written
//   • Error    → 'error' result event written
//
// Session status is inferred from the NDJSON log by the server — no status
// files are written by this worker.

// Configure the LLM backend before any SDK import resolves its config.
// If the caller injected PRIMORDIA_USER_API_KEY via env, use the direct
// Anthropic API with that key.  Otherwise fall back to the exe.dev gateway.
const GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/anthropic';
const _userApiKey = process.env.PRIMORDIA_USER_API_KEY;
if (_userApiKey) {
  // Direct Anthropic API — set the key and make sure no gateway URL is set.
  process.env.ANTHROPIC_API_KEY = _userApiKey;
  delete process.env.ANTHROPIC_BASE_URL;
} else {
  // exe.dev LLM gateway — no real API key required.
  process.env.ANTHROPIC_BASE_URL = GATEWAY_BASE_URL;
  process.env.ANTHROPIC_API_KEY = 'gateway'; // SDK requires non-empty
}
// Clear from process env immediately so it does not appear in any child
// processes spawned by Claude Code (e.g. bash tool invocations).
delete process.env.PRIMORDIA_USER_API_KEY;

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs';
import * as path from 'path';
import {
  appendSessionEvent,
  getSessionNdjsonPath,
} from '../lib/session-events';

interface WorkerConfig {
  sessionId: string;
  worktreePath: string;
  repoRoot: string;
  prompt: string;
  timeoutMs?: number;
  /** Model ID to use for this run. Omit to use the SDK/harness default. */
  model?: string;
  /** When true, continue the most recent Claude Code session in the worktree directory. */
  useContinue?: boolean;
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

  const { sessionId, worktreePath, repoRoot, prompt, useContinue } = config;
  const timeoutMs = config.timeoutMs ?? 20 * 60 * 1000;
  const model = config.model;

  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  const ts = () => Date.now();

  const pidFile = path.join(worktreePath, '.primordia-worker.pid');
  try {
    fs.writeFileSync(pidFile, String(process.pid), 'utf8');
  } catch (err) {
    process.stderr.write(`Warning: could not write PID file: ${err}\n`);
  }

  function cleanup(): void {
    try { fs.rmSync(pidFile, { force: true }); } catch { /* best-effort */ }
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

  let capturedDurationMs: number | null = null;
  let capturedInputTokens: number | null = null;
  let capturedOutputTokens: number | null = null;
  let capturedCostUsd: number | null = null;

  // Wall-clock start time — used as fallback for durationMs when the SDK does
  // not return a result message (e.g. on errors).
  const startTime = Date.now();

  // sessionId is available in config but not used directly here — status/previewUrl
  // are now inferred from events by the server, not written by the worker.
  void sessionId;

  try {
    const run = query({
      prompt,
      options: {
        cwd: worktreePath,
        ...(model ? { model } : {}),
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `The current working directory is: ${worktreePath}`,
        },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController,
        continue: useContinue ?? false,
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
              appendSessionEvent(ndjsonPath, { type: 'text', content: block.text, ts: ts() });
            } else if (block.type === 'tool_use') {
              appendSessionEvent(ndjsonPath, {
                type: 'tool_use',
                name: block.name,
                input: block.input as Record<string, unknown>,
                ts: ts(),
              });
            }
          }
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
        appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'timeout', message: 'Claude Code timed out after 20 minutes.', ts: ts() });
        appendSessionEvent(ndjsonPath, { type: 'metrics', durationMs: capturedDurationMs ?? (Date.now() - startTime), inputTokens: capturedInputTokens, outputTokens: capturedOutputTokens, costUsd: capturedCostUsd, ts: ts() });
        clearTimeout(timeoutId);
        cleanup();
        process.exit(0);
      } else if (userAborted) {
        appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'aborted', message: 'Claude Code was aborted by user.', ts: ts() });
        appendSessionEvent(ndjsonPath, { type: 'metrics', durationMs: capturedDurationMs ?? (Date.now() - startTime), inputTokens: capturedInputTokens, outputTokens: capturedOutputTokens, costUsd: capturedCostUsd, ts: ts() });
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

    // Successful completion — write result and metrics events.
    // Status ('ready') is inferred by the server from the presence of this result event.
    appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'success', ts: ts() });
    appendSessionEvent(ndjsonPath, { type: 'metrics', durationMs: capturedDurationMs, inputTokens: capturedInputTokens, outputTokens: capturedOutputTokens, costUsd: capturedCostUsd, ts: ts() });

    cleanup();
    process.exit(0);
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    const causeMsg =
      err instanceof Error && err.cause instanceof Error
        ? `\nCaused by: ${err.cause.message}`
        : '';
    appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'error', message: msg + causeMsg, ts: ts() });
    appendSessionEvent(ndjsonPath, { type: 'metrics', durationMs: capturedDurationMs ?? (Date.now() - startTime), inputTokens: capturedInputTokens, outputTokens: capturedOutputTokens, costUsd: capturedCostUsd, ts: ts() });
    cleanup();
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Unhandled worker error: ${err}\n`);
  process.exit(1);
});
