// scripts/pi-worker.ts
// Standalone pi coding agent worker process. Spawned by the app server as a
// detached child so it survives server restarts.
//
// Usage: bun scripts/pi-worker.ts <config-file>
//
// Process lifecycle:
//   • Writes PID to {worktreePath}/.primordia-worker.pid on startup
//   • Deletes the PID file on exit (any exit path)
//   • Writes structured events to {worktreePath}/.primordia-session.ndjson
//   • SIGTERM → graceful abort: agent is stopped, 'aborted' result event written
//   • Timeout  → same effect as SIGTERM
//   • Success  → 'success' result event written
//   • Error    → 'error' result event written
//
// Session status is inferred from the NDJSON log by the server — no status
// files are written by this worker.

import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  DefaultResourceLoader,
  createCodingTools,
  getAgentDir,
  type ExtensionFactory,
} from '@mariozechner/pi-coding-agent';
import * as fs from 'fs';
import * as path from 'path';
import {
  appendSessionEvent,
  getSessionNdjsonPath,
} from '../lib/session-events';

// ---------------------------------------------------------------------------
// LLM backend configuration
// ---------------------------------------------------------------------------

const ANTHROPIC_GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/anthropic';
const OPENAI_GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/openai';

/** Infer the pi provider name from a model ID. Defaults to 'anthropic'. */
function inferProvider(modelId: string): 'anthropic' | 'openai' {
  if (modelId.startsWith('gpt-') || /^o\d/.test(modelId)) return 'openai';
  return 'anthropic';
}

// Capture and immediately clear the injected user API key so it does not
// persist in process.env (and cannot leak to child processes).
const _userApiKey = process.env.PRIMORDIA_USER_API_KEY;
delete process.env.PRIMORDIA_USER_API_KEY;

interface WorkerConfig {
  sessionId: string;
  worktreePath: string;
  repoRoot: string;
  prompt: string;
  timeoutMs?: number;
  /** Model ID to use for this run (e.g. 'claude-sonnet-4-6'). Omit to use the SDK default. */
  model?: string;
  /** When true, continue the most recent pi session in the worktree directory. */
  useContinue?: boolean;
}

async function main(): Promise<void> {
  const configFile = process.argv[2];
  if (!configFile) {
    process.stderr.write('Usage: bun scripts/pi-worker.ts <config-file>\n');
    process.exit(1);
  }

  let config: WorkerConfig;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8')) as WorkerConfig;
  } catch (err) {
    process.stderr.write(`Failed to read config file: ${err}\n`);
    process.exit(1);
  }

  const { sessionId, worktreePath, prompt, useContinue } = config;
  const timeoutMs = config.timeoutMs ?? 20 * 60 * 1000;
  const modelId = config.model;

  // sessionId is available in config but not used directly here.
  void sessionId;

  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  const ts = () => Date.now();
  const startTime = ts();

  const pidFile = path.join(worktreePath, '.primordia-worker.pid');
  try {
    fs.writeFileSync(pidFile, String(process.pid), 'utf8');
  } catch (err) {
    process.stderr.write(`Warning: could not write PID file: ${err}\n`);
  }

  function cleanup(): void {
    try { fs.rmSync(pidFile, { force: true }); } catch { /* best-effort */ }
  }

  let timedOut = false;
  let userAborted = false;
  // Holds the session reference once created so signal handlers can abort it.
  let activeSession: { abort(): Promise<void>; getSessionStats(): { tokens: { input: number; output: number }; cost: number } } | null = null;
  // Baseline stats snapshot taken before the prompt runs — used to compute
  // incremental metrics for this run only (avoids counting prior follow-up runs).
  // Stored in outer scope so abort/timeout/error paths can compute partial metrics.
  let baselineStatsRef: { tokens: { input: number; output: number }; cost: number } | null = null;
  // Track the last assistant message stop reason so we can detect max_tokens
  // truncation after session.prompt() resolves. When the model hits max_tokens
  // the response is cut off mid-generation; no tool calls are included, so the
  // agent loop exits cleanly and prompt() resolves without throwing — but the
  // task is not complete.
  let lastAssistantStopReason: string | null = null;
  // Track whether the last assistant turn produced any visible text output.
  // When the model uses extended thinking / reasoning it can generate output
  // tokens (thinking blocks) that never fire text_delta events. If the final
  // turn has NO visible text AND no tool calls, the model stopped silently —
  // usually because the context window was nearly full and there was no room
  // left for a real conclusion. We surface this as an error so the user knows
  // to follow up rather than assuming the task completed successfully.
  let lastAssistantHadVisibleOutput = false;
  let lastAssistantHadToolCalls = false;
  // Track the last API-level error message (e.g. invalid API key). The Pi SDK
  // emits a message_update event with assistantMessageEvent.type === 'error'
  // but does NOT throw from session.prompt() — we must detect and re-throw it
  // ourselves so the session is correctly reported as errored rather than done.
  let lastApiErrorMessage: string | null = null;

  process.on('SIGTERM', () => {
    userAborted = true;
    activeSession?.abort().catch(() => {});
  });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    activeSession?.abort().catch(() => {});
  }, timeoutMs);

  try {
    // Auth — use the user-supplied API key when available, otherwise fall back
    // to the exe.dev LLM gateway (which handles auth with any non-empty key).
    const authStorage = AuthStorage.create();
    const modelProvider = modelId ? inferProvider(modelId) : 'anthropic';
    if (_userApiKey) {
      authStorage.setRuntimeApiKey(modelProvider, _userApiKey);
      process.stderr.write(`Using user-supplied ${modelProvider} API key\n`);
    } else {
      // Gateway handles auth for all providers — set a placeholder key for each
      // supported provider so the SDK knows auth is configured.
      authStorage.setRuntimeApiKey('anthropic', 'gateway');
      authStorage.setRuntimeApiKey('openai', 'gateway');
      process.stderr.write('Using exe.dev LLM gateway\n');
    }

    const modelRegistry = ModelRegistry.create(authStorage);

    // Resolve the model object from the string ID, if provided.
    let model: ReturnType<typeof modelRegistry.find> | undefined;
    if (modelId) {
      model = modelRegistry.find(modelProvider, modelId) ?? undefined;
      if (!model) {
        process.stderr.write(`Warning: model '${modelId}' not found in registry for provider '${modelProvider}', using default\n`);
      }
    }

    // Use continueRecent when resuming a follow-up so full conversation history
    // is preserved without us having to reconstruct it manually.
    const sessionMgr = useContinue
      ? SessionManager.continueRecent(worktreePath)
      : SessionManager.create(worktreePath);

    // Register the gateway as the Anthropic provider base URL via an inline
    // extension factory — only when NOT using a direct user API key.
    // extensionFactories are always applied even when noExtensions is true
    // (which only disables file-based extension discovery).
    const extensionFactories: ExtensionFactory[] = _userApiKey
      ? [] // direct provider API — no custom baseUrl needed
      : [
          (pi: Parameters<ExtensionFactory>[0]) => {
            // Route all supported providers through the exe.dev LLM gateway.
            pi.registerProvider('anthropic', { baseUrl: ANTHROPIC_GATEWAY_BASE_URL });
            pi.registerProvider('openai', { baseUrl: OPENAI_GATEWAY_BASE_URL });
          },
        ];

    // Resource loader: use the worktree as cwd so pi discovers AGENTS.md
    // (symlinked to CLAUDE.md) and other project context, and append the
    // working-directory line. Skills are discovered from .pi/skills/ which
    // is symlinked to .claude/skills/ — no code changes needed for either.
    const loader = new DefaultResourceLoader({
      cwd: worktreePath,
      agentDir: getAgentDir(),
      appendSystemPrompt: `The current working directory is: ${worktreePath}`,
      // Disable extension discovery — extensions are not needed for headless runs
      // and may require interactive input or write to unexpected locations.
      noExtensions: true,
      extensionFactories,
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: worktreePath,
      ...(model ? { model } : {}),
      authStorage,
      modelRegistry,
      resourceLoader: loader,
      sessionManager: sessionMgr,
      tools: createCodingTools(worktreePath),
    });

    activeSession = session;

    // Snapshot baseline stats *before* the prompt so we can compute incremental
    // (per-run) metrics rather than cumulative session-wide totals.
    // When useContinue=true the session is resumed from a saved file and already
    // carries token/cost totals from all previous turns.  Subtracting the
    // baseline gives us only the tokens / cost consumed by THIS run.
    const baselineStats = session.getSessionStats();
    baselineStatsRef = baselineStats;

    // Subscribe to events and write them to the NDJSON log.
    session.subscribe((event) => {
      if (event.type === 'message_update') {
        const ae = event.assistantMessageEvent;
        if (ae.type === 'text_delta' && ae.delta) {
          appendSessionEvent(ndjsonPath, { type: 'text', content: ae.delta, ts: ts() });
        } else if (ae.type === 'error') {
          // Capture API errors (e.g. invalid API key). session.prompt() resolves
          // without throwing in this case, so we must detect it here and surface
          // it after prompt() returns.
          lastApiErrorMessage = ae.error.errorMessage ?? `API error (${ae.reason})`;
        }
      } else if (event.type === 'compaction_start') {
        // Auto-compaction: the SDK is summarising conversation history to free
        // up context window space. Log it so the user can see it happened.
        const ev = event as { type: 'compaction_start'; reason: string };
        appendSessionEvent(ndjsonPath, {
          type: 'text',
          content: `\n\n⚙️ **Context compacting** (${ev.reason}) — summarising conversation history to free up context space.\n`,
          ts: ts(),
        });
      } else if (event.type === 'compaction_end') {
        const ev = event as {
          type: 'compaction_end';
          reason: string;
          aborted: boolean;
          willRetry: boolean;
          errorMessage?: string;
        };
        if (!ev.aborted && !ev.errorMessage) {
          appendSessionEvent(ndjsonPath, {
            type: 'text',
            content: `\n\n⚙️ **Context compacted** (${ev.reason}) — history summarised.\n`,
            ts: ts(),
          });
        } else if (ev.errorMessage) {
          appendSessionEvent(ndjsonPath, {
            type: 'text',
            content: `\n\n⚠️ **Context compaction failed**: ${ev.errorMessage}${ev.willRetry ? ' (will retry)' : ''}\n`,
            ts: ts(),
          });
        }
      } else if (event.type === 'auto_retry_start') {
        const ev = event as {
          type: 'auto_retry_start';
          attempt: number;
          maxAttempts: number;
          delayMs: number;
          errorMessage: string;
        };
        appendSessionEvent(ndjsonPath, {
          type: 'text',
          content: `\n\n🔄 **Auto-retry** (attempt ${ev.attempt}/${ev.maxAttempts}, delay ${Math.round(ev.delayMs / 1000)}s): ${ev.errorMessage}\n`,
          ts: ts(),
        });
      } else if (event.type === 'auto_retry_end') {
        const ev = event as { type: 'auto_retry_end'; success: boolean; attempt: number; finalError?: string };
        if (!ev.success) {
          appendSessionEvent(ndjsonPath, {
            type: 'text',
            content: `\n\n❌ **Auto-retry exhausted** after ${ev.attempt} attempt(s)${ev.finalError ? `: ${ev.finalError}` : ''}.\n`,
            ts: ts(),
          });
          // Treat exhausted retries as an API error so session reports as errored, not finished.
          lastApiErrorMessage = ev.finalError ?? 'API error: retries exhausted';
        }
      } else if (event.type === 'tool_execution_start') {
        appendSessionEvent(ndjsonPath, {
          type: 'tool_use',
          name: event.toolName,
          input: (event.args ?? {}) as Record<string, unknown>,
          ts: ts(),
        });
      } else if (event.type === 'message_end') {
        // Track stop reason and content shape for post-prompt analysis.
        // Cast to a plain object because the union type doesn't expose stopReason
        // directly — only AssistantMessage has it.
        const msg = event.message as unknown as Record<string, unknown>;
        if (msg['role'] === 'assistant' && typeof msg['stopReason'] === 'string') {
          lastAssistantStopReason = msg['stopReason'];
          const content = (msg['content'] as Array<{ type: string; text?: string }>) ?? [];
          // Visible text = a text block with non-empty content (not thinking/reasoning)
          lastAssistantHadVisibleOutput = content.some(
            (c) => c.type === 'text' && typeof c.text === 'string' && c.text.trim().length > 0,
          );
          // Tool calls in this turn = model is still working
          lastAssistantHadToolCalls = content.some((c) => c.type === 'toolCall');
          // Capture API errors surfaced as a message_end with stopReason 'error'.
          // The pi-ai Anthropic provider emits { type: 'error' } on the stream when
          // the API returns an HTTP error (e.g. 402 credits exhausted). The
          // agent-loop converts this directly to message_start + message_end without
          // emitting a message_update event, so the message_update 'error' handler
          // above never fires. We detect it here instead.
          if (msg['stopReason'] === 'error' && !lastApiErrorMessage) {
            const errMsg = typeof msg['errorMessage'] === 'string' ? msg['errorMessage'] : null;
            lastApiErrorMessage = errMsg ?? 'API error (unknown)';
          }
        }
        // Emit a partial metrics snapshot after each assistant turn so the
        // session view can show live token and cost data while the agent runs.
        const midStats = session.getSessionStats();
        const midInput = midStats.tokens.input - baselineStats.tokens.input;
        const midOutput = midStats.tokens.output - baselineStats.tokens.output;
        const midCost = midStats.cost - baselineStats.cost;
        appendSessionEvent(ndjsonPath, {
          type: 'metrics',
          durationMs: ts() - startTime,
          inputTokens: midInput > 0 ? midInput : null,
          outputTokens: midOutput > 0 ? midOutput : null,
          costUsd: midCost > 0 ? midCost : null,
          ts: ts(),
        });
      }
    });

    // Run the prompt and handle abort/timeout.
    try {
      await session.prompt(prompt);
    } catch (err) {
      if (timedOut) {
        appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'timeout', message: 'Pi agent timed out after 20 minutes.', ts: ts() });
        const timeoutStats = activeSession?.getSessionStats();
        const timeoutInput = timeoutStats && baselineStatsRef ? timeoutStats.tokens.input - baselineStatsRef.tokens.input : null;
        const timeoutOutput = timeoutStats && baselineStatsRef ? timeoutStats.tokens.output - baselineStatsRef.tokens.output : null;
        const timeoutCost = timeoutStats && baselineStatsRef ? timeoutStats.cost - baselineStatsRef.cost : null;
        appendSessionEvent(ndjsonPath, { type: 'metrics', durationMs: ts() - startTime, inputTokens: timeoutInput != null && timeoutInput > 0 ? timeoutInput : null, outputTokens: timeoutOutput != null && timeoutOutput > 0 ? timeoutOutput : null, costUsd: timeoutCost != null && timeoutCost > 0 ? timeoutCost : null, ts: ts() });
        clearTimeout(timeoutId);
        cleanup();
        process.exit(0);
      } else if (userAborted) {
        appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'aborted', message: 'Pi agent was aborted by user.', ts: ts() });
        const abortStats = activeSession?.getSessionStats();
        const abortInput = abortStats && baselineStatsRef ? abortStats.tokens.input - baselineStatsRef.tokens.input : null;
        const abortOutput = abortStats && baselineStatsRef ? abortStats.tokens.output - baselineStatsRef.tokens.output : null;
        const abortCost = abortStats && baselineStatsRef ? abortStats.cost - baselineStatsRef.cost : null;
        appendSessionEvent(ndjsonPath, { type: 'metrics', durationMs: ts() - startTime, inputTokens: abortInput != null && abortInput > 0 ? abortInput : null, outputTokens: abortOutput != null && abortOutput > 0 ? abortOutput : null, costUsd: abortCost != null && abortCost > 0 ? abortCost : null, ts: ts() });
        clearTimeout(timeoutId);
        cleanup();
        process.exit(0);
      } else {
        throw err;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    // Re-throw any API-level error that the SDK swallowed (e.g. invalid API key).
    // The SDK emits a message_update 'error' event but resolves prompt() cleanly,
    // so without this check the session would be reported as successful.
    if (lastApiErrorMessage) {
      throw new Error(lastApiErrorMessage);
    }

    // Collect incremental token/cost metrics: delta from baseline to avoid
    // reporting cumulative session totals in follow-up runs.
    const finalStats = session.getSessionStats();
    const incrementalInput = finalStats.tokens.input - baselineStats.tokens.input;
    const incrementalOutput = finalStats.tokens.output - baselineStats.tokens.output;
    const incrementalCost = finalStats.cost - baselineStats.cost;
    const durationMs = ts() - startTime;

    // Report context window usage after the session completes. Helps users
    // understand why Pi may have stopped short — a full context window leaves
    // no room for a proper conclusion or further tool calls.
    const contextUsage = session.getContextUsage();
    if (
      contextUsage != null &&
      contextUsage.tokens != null &&
      contextUsage.percent != null &&
      contextUsage.percent >= 75
    ) {
      appendSessionEvent(ndjsonPath, {
        type: 'text',
        content:
          `\n\n⚠️ **Context window ${Math.round(contextUsage.percent)}% full** (` +
          `${contextUsage.tokens.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens). ` +
          `If the response seems incomplete, follow up to continue.\n`,
        ts: ts(),
      });
    }

    // Detect max_tokens truncation: if the model's last response had
    // stopReason 'length', it was cut off before completing its work.
    // The agent loop exits normally in this case (no tool calls → done),
    // so we must detect it here and surface an error so the user knows
    // a follow-up is needed to continue.
    const truncated = lastAssistantStopReason === 'length';
    if (truncated) {
      appendSessionEvent(ndjsonPath, {
        type: 'text',
        content:
          "\n\n\u274c The AI's response was longer than expected, so it was paused. " +
          "Follow-up with 'continue' and it'll pick up right where it left off.",
        ts: ts(),
      });
    }

    // Detect silent stop: the model's final turn produced no visible text and
    // no tool calls — only reasoning/thinking tokens (which don't emit
    // text_delta events). This happens when the context window is nearly full
    // and the model "thinks" but has no space left for a real response, or
    // when the model loses track of what it was doing. stopReason is 'stop'
    // so the max_tokens check above won't catch it.
    const silentStop =
      !truncated &&
      !lastAssistantHadVisibleOutput &&
      !lastAssistantHadToolCalls &&
      (lastAssistantStopReason === 'stop' || lastAssistantStopReason === null);
    if (silentStop) {
      appendSessionEvent(ndjsonPath, {
        type: 'text',
        content:
          '\n\n\u274c **Pi stopped without generating visible output.** The final response ' +
          'contained no text or tool calls (only internal reasoning tokens). ' +
          'This typically means the context window was too full for a proper conclusion. ' +
          "Follow up with 'please summarise what you found and implement the changes' to continue.",
        ts: ts(),
      });
    }

    appendSessionEvent(ndjsonPath, {
      type: 'result',
      subtype: truncated || silentStop ? 'error' : 'success',
      ...(truncated
        ? { message: 'Pi hit the output token limit (max_tokens) and stopped mid-response.' }
        : silentStop
          ? { message: 'Pi stopped silently — final response had no visible text or tool calls (context window likely full).' }
          : {}),
      ts: ts(),
    });
    appendSessionEvent(ndjsonPath, {
      type: 'metrics',
      durationMs,
      inputTokens: incrementalInput > 0 ? incrementalInput : null,
      outputTokens: incrementalOutput > 0 ? incrementalOutput : null,
      costUsd: incrementalCost > 0 ? incrementalCost : null,
      ts: ts(),
    });

    cleanup();
    process.exit(0);
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'error', message: msg, ts: ts() });
    const errStats = activeSession?.getSessionStats();
    const errInput = errStats && baselineStatsRef ? errStats.tokens.input - baselineStatsRef.tokens.input : null;
    const errOutput = errStats && baselineStatsRef ? errStats.tokens.output - baselineStatsRef.tokens.output : null;
    const errCost = errStats && baselineStatsRef ? errStats.cost - baselineStatsRef.cost : null;
    appendSessionEvent(ndjsonPath, { type: 'metrics', durationMs: ts() - startTime, inputTokens: errInput != null && errInput > 0 ? errInput : null, outputTokens: errOutput != null && errOutput > 0 ? errOutput : null, costUsd: errCost != null && errCost > 0 ? errCost : null, ts: ts() });
    cleanup();
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Unhandled pi worker error: ${err}\n`);
  process.exit(1);
});
