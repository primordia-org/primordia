// scripts/codex-worker.ts
// Standalone OpenAI Codex CLI worker process. Spawned by the app server as a
// detached child so it survives server restarts.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { appendSessionEvent, getSessionNdjsonPath, type SessionEvent } from '@/lib/session-events';
import { PROGRESS_MONITOR_PROMPT } from '@/lib/progress-prompt';
import { decryptWorkerSecret } from '@/lib/worker-secret-env';

const OPENAI_GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/openai/v1';

const _primordiaAesKey = process.env.PRIMORDIA_AES_KEY;
delete process.env.PRIMORDIA_AES_KEY;
let _userApiKey: string | undefined;
let _chatGptOAuth: string | undefined;
let _requiredAuthSource: string | null | undefined;

interface WorkerConfig {
  sessionId: string;
  worktreePath: string;
  repoRoot: string;
  prompt: string;
  timeoutMs?: number;
  model?: string;
  useContinue?: boolean;
  encryptedSecret?: string;
  authSource?: string | null;
}

function normalizeModelId(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return model.startsWith('openai-codex:') ? model.slice('openai-codex:'.length) : model;
}

function writeCodexConfig(codexHome: string, authMode: 'gateway' | 'api-key' | 'chatgpt'): void {
  fs.mkdirSync(codexHome, { recursive: true });
  try { fs.rmSync(path.join(codexHome, 'auth.json'), { force: true }); } catch { /* best-effort */ }
  const common = 'cli_auth_credentials_store = "file"\n';
  if (authMode === 'gateway') {
    fs.writeFileSync(
      path.join(codexHome, 'config.toml'),
      common +
        'model_provider = "exe-openai"\n\n' +
        '[model_providers.exe-openai]\n' +
        'name = "exe.dev LLM Gateway"\n' +
        `base_url = "${OPENAI_GATEWAY_BASE_URL}"\n` +
        'requires_openai_auth = false\n',
      'utf8',
    );
    return;
  }

  fs.writeFileSync(path.join(codexHome, 'config.toml'), common, 'utf8');

  if (authMode === 'api-key') {
    fs.writeFileSync(
      path.join(codexHome, 'auth.json'),
      JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: _userApiKey }, null, 2),
      'utf8',
    );
    return;
  }

  if (!_chatGptOAuth) throw new Error('ChatGPT subscription credentials were not provided.');
  const stored = JSON.parse(_chatGptOAuth) as {
    tokens?: {
      idToken?: string;
      accessToken?: string;
      refreshToken?: string;
      accountId?: string | null;
    };
    lastRefresh?: string;
  };
  const idToken = stored.tokens?.idToken;
  const accessToken = stored.tokens?.accessToken;
  const refreshToken = stored.tokens?.refreshToken;
  if (!idToken || !accessToken || !refreshToken) {
    throw new Error('Stored ChatGPT subscription credentials are missing tokens. Reconnect ChatGPT in Settings → Subscriptions.');
  }
  fs.writeFileSync(
    path.join(codexHome, 'auth.json'),
    JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        id_token: idToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        account_id: stored.tokens?.accountId ?? undefined,
      },
      last_refresh: stored.lastRefresh ?? new Date().toISOString(),
    }, null, 2),
    'utf8',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
}

function stripShellWrapper(command: string): string {
  const match = command.match(/^(?:\/bin\/)?(?:ba|z|fi)?sh\s+-lc\s+([\s\S]+)$/);
  if (!match) return command;
  const wrapped = match[1].trim();
  if (
    (wrapped.startsWith("'") && wrapped.endsWith("'")) ||
    (wrapped.startsWith('"') && wrapped.endsWith('"'))
  ) {
    return wrapped.slice(1, -1);
  }
  return wrapped;
}

function commandFromItem(item: Record<string, unknown>): string {
  if (Array.isArray(item.command)) {
    const parts = item.command.map((part) => String(part));
    if ((parts[0] === '/bin/bash' || parts[0] === 'bash' || parts[0] === '/bin/sh' || parts[0] === 'sh') && parts.includes('-lc')) {
      return parts[parts.indexOf('-lc') + 1] ?? parts.join(' ');
    }
    if ((parts[0] === '/bin/bash' || parts[0] === 'bash' || parts[0] === '/bin/sh' || parts[0] === 'sh') && parts.includes('-c')) {
      return parts[parts.indexOf('-c') + 1] ?? parts.join(' ');
    }
    return parts.join(' ');
  }

  const command = typeof item.command === 'string'
    ? item.command.trim()
    : isRecord(item.arguments) && typeof item.arguments.cmd === 'string' ? item.arguments.cmd.trim() : '';
  const args = Array.isArray(item.args)
    ? item.args.map((arg) => String(arg))
    : isRecord(item.arguments) && Array.isArray(item.arguments.args) ? item.arguments.args.map((arg) => String(arg)) : [];
  const shell = command === '/bin/bash' || command === 'bash' || command === '/bin/sh' || command === 'sh';
  const shellCommandIndex = args.findIndex((arg) => arg === '-lc' || arg === '-c');
  if (shell && shellCommandIndex >= 0 && args[shellCommandIndex + 1]) {
    return args[shellCommandIndex + 1];
  }
  if (shell && args.length > 0) return [command, ...args].join(' ');
  return stripShellWrapper(command);
}

function normalizeTodoList(item: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(item.items) ? item.items : [];
  return {
    todos: items
      .filter(isRecord)
      .map((todo) => ({
        content: stringify(todo.text ?? todo.content ?? ''),
        status: todo.completed === true || todo.status === 'completed' ? 'completed' : 'pending',
      }))
      .filter((todo) => todo.content.trim()),
  };
}

function fileChangeEvents(item: Record<string, unknown>, ts: number): SessionEvent[] {
  const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
  if (changes.length === 0) {
    return [{ type: 'tool_use', name: 'Edit', input: {}, ts }];
  }
  return changes.map((change) => {
    const kind = typeof change.kind === 'string' ? change.kind : 'update';
    const pathValue = typeof change.path === 'string' ? change.path : '';
    const name = kind === 'add' ? 'Write' : kind === 'delete' ? 'Delete' : 'Edit';
    return {
      type: 'tool_use',
      name,
      input: { path: pathValue, kind },
      ts,
    };
  });
}

function toolEventFromItem(item: Record<string, unknown>, ts: number): SessionEvent[] {
  const itemType = item.type;
  if (itemType === 'command_execution') {
    const command = commandFromItem(item);
    return [{ type: 'tool_use', name: 'Bash', input: command ? { command } : {}, ts }];
  }
  if (itemType === 'file_change') return fileChangeEvents(item, ts);
  if (itemType === 'mcp_tool_call') {
    const server = typeof item.server === 'string' ? item.server : 'mcp';
    const tool = typeof item.tool === 'string' ? item.tool : 'tool';
    const input = isRecord(item.arguments) ? item.arguments : {};
    return [{ type: 'tool_use', name: `${server}.${tool}`, input, ts }];
  }
  if (itemType === 'collab_tool_call') {
    const tool = typeof item.tool === 'string' ? item.tool : 'collab';
    return [{
      type: 'tool_use',
      name: tool,
      input: {
        prompt: item.prompt,
        receiver_thread_ids: item.receiver_thread_ids,
      },
      ts,
    }];
  }
  if (itemType === 'web_search') {
    return [{
      type: 'tool_use',
      name: 'WebSearch',
      input: {
        query: typeof item.query === 'string' ? item.query : '',
        action: item.action,
      },
      ts,
    }];
  }
  if (itemType === 'todo_list') {
    return [{ type: 'tool_use', name: 'TodoWrite', input: normalizeTodoList(item), ts }];
  }
  return [];
}

interface CodexRunState {
  sawTurnCompleted: boolean;
  sawTerminalFailure: boolean;
  sawBenignWebSocketCloseAfterSuccess: boolean;
}

function codexEventMessage(event: Record<string, unknown>): string {
  const message = event.message ?? event.error;
  if (typeof message === 'string') return message;
  if (isRecord(message) && typeof message.message === 'string') return message.message;
  return stringify(message ?? '');
}

function isBenignCodexWebSocketCloseMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('websocket closed 1006') && normalized.includes('connection ended');
}

function eventsFromCodexEvent(event: Record<string, unknown>, emittedToolItemIds: Set<string>, state: CodexRunState): SessionEvent[] {
  const ts = Date.now();
  const type = event.type;
  if (type === 'item.started' || type === 'item.updated') {
    const item = isRecord(event.item) ? event.item : null;
    if (!item) return [];
    const itemId = typeof item.id === 'string' ? item.id : null;
    if (itemId) emittedToolItemIds.add(itemId);
    if (type === 'item.updated' && item.type !== 'todo_list') return [];
    return toolEventFromItem(item, ts);
  }
  if (type === 'item.completed') {
    const item = isRecord(event.item) ? event.item : null;
    if (!item) return [];
    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
      return [{ type: 'text', content: item.text, ts }];
    }
    if (item.type === 'reasoning') {
      const text = typeof item.text === 'string' ? item.text : '';
      return [{ type: 'thinking', content: text, ts }];
    }
    if (item.type === 'error') {
      return [{ type: 'text', content: `\n\n⚠️ ${stringify(item.message ?? 'Codex reported an error')}\n`, ts }];
    }
    const itemId = typeof item.id === 'string' ? item.id : null;
    if (itemId && emittedToolItemIds.has(itemId)) {
      emittedToolItemIds.delete(itemId);
      return [];
    }
    return toolEventFromItem(item, ts);
  }
  if (type === 'agent_message' && typeof event.message === 'string') {
    return [{ type: 'text', content: event.message, ts }];
  }
  if (type === 'turn.completed') {
    state.sawTurnCompleted = true;
    const usage = isRecord(event.usage) ? event.usage : null;
    if (usage) {
      const input = typeof usage.input_tokens === 'number'
        ? usage.input_tokens
        : typeof usage.total_input_tokens === 'number' ? usage.total_input_tokens : null;
      const output = typeof usage.output_tokens === 'number'
        ? usage.output_tokens
        : typeof usage.total_output_tokens === 'number' ? usage.total_output_tokens : null;
      const reasoning = typeof usage.reasoning_output_tokens === 'number' ? usage.reasoning_output_tokens : 0;
      return [{
        type: 'metrics',
        durationMs: null,
        inputTokens: input,
        outputTokens: output == null ? null : output + reasoning,
        costUsd: null,
        ts,
      }];
    }
  }
  if (type === 'turn.failed') {
    state.sawTerminalFailure = true;
    const error = isRecord(event.error) ? event.error : {};
    return [{ type: 'text', content: `\n\n❌ **Codex failed**: ${stringify(error.message ?? 'Unknown Codex error')}\n`, ts }];
  }
  if (type === 'error' || type === 'stream_error') {
    const message = codexEventMessage(event);
    if (state.sawTurnCompleted && isBenignCodexWebSocketCloseMessage(message)) {
      state.sawBenignWebSocketCloseAfterSuccess = true;
      return [];
    }
    state.sawTerminalFailure = true;
    return [{ type: 'text', content: `\n\n❌ **Codex error**: ${message || 'Unknown Codex error'}\n`, ts }];
  }
  return [];
}

async function main(): Promise<void> {
  const configFile = process.argv[2];
  if (!configFile) {
    process.stderr.write('Usage: bun scripts/codex-worker.ts <config-file>\n');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configFile, 'utf8')) as WorkerConfig;
  _requiredAuthSource = config.authSource;
  try {
    const secret = await decryptWorkerSecret(config.encryptedSecret, _primordiaAesKey, config.authSource);
    _userApiKey = secret.apiKey;
    _chatGptOAuth = secret.chatGptOAuth;
  } catch (err) {
    throw new Error(`Could not decrypt selected billing source with PRIMORDIA_AES_KEY: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { sessionId, worktreePath, prompt, useContinue } = config;
  const timeoutMs = config.timeoutMs ?? 20 * 60 * 1000;

  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  const pidFile = path.join(worktreePath, '.primordia-worker.pid');
  const homeDir = process.env.HOME ?? '/home/exedev';
  const codexHome = path.join(homeDir, '.primordia-codex', sessionId);

  fs.writeFileSync(pidFile, String(process.pid), 'utf8');
  const cleanup = () => { try { fs.rmSync(pidFile, { force: true }); } catch {} };

  let child: ReturnType<typeof spawn> | null = null;
  let timedOut = false;
  process.on('SIGTERM', () => { child?.kill('SIGTERM'); });
  const timeoutId = setTimeout(() => { timedOut = true; child?.kill('SIGTERM'); }, timeoutMs);

  try {
    if (_requiredAuthSource === 'chatgpt-subscription' && !_chatGptOAuth) {
      throw new Error('ChatGPT subscription was selected, but ChatGPT credentials were not provided. Refusing to fall back to the exe.dev LLM gateway.');
    }
    const authMode = _chatGptOAuth ? 'chatgpt' : (_userApiKey ? 'api-key' : 'gateway');
    writeCodexConfig(codexHome, authMode);
    process.stderr.write(`Using Codex with ${authMode === 'gateway' ? 'exe.dev LLM gateway' : authMode === 'api-key' ? 'user-supplied OpenAI API key' : 'ChatGPT subscription OAuth'}\n`);

    const args = useContinue
      ? ['exec', 'resume', '--last', '--json', '--dangerously-bypass-approvals-and-sandbox']
      : ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox'];
    const model = normalizeModelId(config.model);
    if (model) args.push('--model', model);
    args.push('-');

    await new Promise<void>((resolve, reject) => {
      const localCodexBin = path.join(config.repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
      const codexCommand = fs.existsSync(localCodexBin) ? localCodexBin : 'codex';
      child = spawn(codexCommand, args, {
        cwd: worktreePath,
        env: { ...process.env, CODEX_HOME: codexHome },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdin?.end(`${PROGRESS_MONITOR_PROMPT}\n\n${prompt}`);
      let stdoutBuf = '';
      const emittedToolItemIds = new Set<string>();
      const runState: CodexRunState = {
        sawTurnCompleted: false,
        sawTerminalFailure: false,
        sawBenignWebSocketCloseAfterSuccess: false,
      };
      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        process.stdout.write(text);
        stdoutBuf += text;
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            for (const sessionEvent of eventsFromCodexEvent(event, emittedToolItemIds, runState)) {
              appendSessionEvent(ndjsonPath, sessionEvent);
            }
          } catch {
            appendSessionEvent(ndjsonPath, { type: 'text', content: `${line}\n`, ts: Date.now() });
          }
        }
      });
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        process.stderr.write(text);
        const isBenignShutdownText = runState.sawTurnCompleted && isBenignCodexWebSocketCloseMessage(text);
        if (isBenignShutdownText) runState.sawBenignWebSocketCloseAfterSuccess = true;
        if (text.trim() && !isBenignShutdownText) appendSessionEvent(ndjsonPath, { type: 'text', content: text, ts: Date.now() });
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (timedOut) reject(new Error(`Codex timed out after ${Math.round(timeoutMs / 1000)}s`));
        else if (signal === 'SIGTERM') reject(new Error('Codex run was aborted'));
        else if (code !== 0) {
          if (runState.sawTurnCompleted && runState.sawBenignWebSocketCloseAfterSuccess && !runState.sawTerminalFailure) {
            resolve();
          } else {
            reject(new Error(`Codex exited with code ${code}`));
          }
        } else resolve();
      });
    });

    appendSessionEvent(ndjsonPath, { type: 'result', subtype: 'success', ts: Date.now() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendSessionEvent(ndjsonPath, { type: 'result', subtype: timedOut ? 'timeout' : 'error', message: msg, ts: Date.now() });
  } finally {
    clearTimeout(timeoutId);
    cleanup();
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
