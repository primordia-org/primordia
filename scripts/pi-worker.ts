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

const GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/anthropic';

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
  let activeSession: { abort(): Promise<void> } | null = null;
  // Track the last assistant message stop reason so we can detect max_tokens
  // truncation after session.prompt() resolves. When the model hits max_tokens
  // the response is cut off mid-generation; no tool calls are included, so the
  // agent loop exits cleanly and prompt() resolves without throwing — but the
  // task is not complete.
  let lastAssistantStopReason: string | null = null;

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
    if (_userApiKey) {
      authStorage.setRuntimeApiKey('anthropic', _userApiKey);
      process.stderr.write('Using user-supplied Anthropic API key\n');
    } else {
      authStorage.setRuntimeApiKey('anthropic', 'gateway');
      process.stderr.write('Using exe.dev LLM gateway\n');
    }

    const modelRegistry = ModelRegistry.create(authStorage);

    // Resolve the model object from the string ID, if provided.
    let model: ReturnType<typeof modelRegistry.find> | undefined;
    if (modelId) {
      model = modelRegistry.find('anthropic', modelId) ?? undefined;
      if (!model) {
        process.stderr.write(`Warning: model '${modelId}' not found in registry, using default\n`);
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
      ? [] // direct Anthropic API — no custom baseUrl needed
      : [(pi: Parameters<ExtensionFactory>[0]) => { pi.registerProvider('anthropic', { baseUrl: GATEWAY_BASE_URL }); }];

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

    // Subscribe to events and write them to the NDJSON log.
    session.subscribe((event) => {
      if (event.type === 'message_update') {
        const ae = event.assistantMessageEvent;
        if (ae.type === 'text_delta' && ae.delta) {
          appendSessionEvent(ndjsonPath, { type: 'text', content: ae.delta, ts: ts() });
        }
      } else if (event.type === 'tool_execution_start') {
        appendSessionEvent(ndjsonPath, {
          type: 'tool_use',
          name: event.toolName,
          input: (event.args ?? {}) as Record<string, unknown>,
          ts: ts(),
        });
      } else if (event.type === 'message_end') {
        // Track stop reason for post-prompt truncation detection.
        // Cast to a plain object because the union type doesn't expose stopReason
        // directly — only AssistantMessage has it.
        const msg = event.message as unknown as Record<string, unknown>;
        if (msg['role'] === 'assistant' && typeof msg['stopReason'] === 'string') {
          lastAssistantStopReason = msg['stopReason'];
        }
      }
    });

    // Run the prompt and handle abort/timeout.
    try {
      await session.prompt(prompt);
    } catch (err) {
      if (timedOut) {
        appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'timeout', message: 'Pi agent timed out after 20 minutes.', ts: ts() });
        appendSessionEvent(ndjsonPath, { type: 'metrics', durationMs: ts() - startTime, inputTokens: null, outputTokens: null, costUsd: null, ts: ts() });
        clearTimeout(timeoutId);
        cleanup();
        process.exit(0);
      } else if (userAborted) {
        appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'aborted', message: 'Pi agent was aborted by user.', ts: ts() });
        appendSessionEvent(ndjsonPath, { type: 'metrics', durationMs: ts() - startTime, inputTokens: null, outputTokens: null, costUsd: null, ts: ts() });
        clearTimeout(timeoutId);
        cleanup();
        process.exit(0);
      } else {
        throw err;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    // Collect final token/cost metrics from the session stats.
    const stats = session.getSessionStats();
    const durationMs = ts() - startTime;

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

    appendSessionEvent(ndjsonPath, {
      type: 'result',
      subtype: truncated ? 'error' : 'success',
      ...(truncated
        ? { message: 'Pi hit the output token limit (max_tokens) and stopped mid-response.' }
        : {}),
      ts: ts(),
    });
    appendSessionEvent(ndjsonPath, {
      type: 'metrics',
      durationMs,
      inputTokens: stats.tokens.input || null,
      outputTokens: stats.tokens.output || null,
      costUsd: stats.cost || null,
      ts: ts(),
    });

    cleanup();
    process.exit(0);
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'error', message: msg, ts: ts() });
    appendSessionEvent(ndjsonPath, { type: 'metrics', durationMs: ts() - startTime, inputTokens: null, outputTokens: null, costUsd: null, ts: ts() });
    cleanup();
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Unhandled pi worker error: ${err}\n`);
  process.exit(1);
});
