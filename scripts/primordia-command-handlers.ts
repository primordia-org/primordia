import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  formatProcessStatusReport,
  getProcessStatusReport,
  publishProductionBranch,
  restartWorktreeServer,
  startWorktreeServer,
  stopWorktreeServer,
  type ProcessStatusReport,
  type ServerStartMode,
} from '@/lib/process-manager';
import { createThread, followupThread, manageThread, updateThread } from '@/lib/threads';
import { getDb } from '@/lib/db';
import { copyProductionDbToWorktree } from '@/lib/production-db-copy';
import { resolvePrimordiaCliKey } from '@/lib/cli-keys';
import {
  CAVEMAN_INTENSITIES,
  PREF_CAVEMAN,
  PREF_CAVEMAN_INTENSITY,
  PREF_HARNESS,
  PREF_MODEL,
  getThreadPrefs,
} from '@/lib/user-prefs';
import { HARNESS_OPTIONS, MODEL_OPTIONS } from '@/lib/agent-config';
import { BUILT_IN_PRESETS, PREF_CUSTOM_PRESETS, PREF_PRESET, PRESET_AUTH_SOURCE_LABELS, parseCustomPresets, type PresetAuthSource } from '@/lib/presets';
import {
  formatJobInterval,
  isPrimordiaJobName,
  listJobSchedules,
  parseJobInterval,
  runPrimordiaJobOnce,
  runPrimordiaJobs,
  setJobScheduleInterval,
  type PrimordiaJobName,
} from '@/lib/scheduled-jobs';
import { completeCliPresetIds, resolveCliPresetIdForUser } from './primordia-preset-helpers';
import type { SessionEvent } from '@/lib/session-events';
import type { CliArgumentDef, CliCommandDef, CliOptionDef, CliParsedArgs, CommandContext } from '@/lib/tiny-command/common';

type UserSelectorArgs = { user?: string };
type JsonArgs = { json?: boolean };
type ModeArgs = { dev?: boolean; prod?: boolean };
type PresetArgs = { preset?: string };
type CavemanArgs = { caveman?: string | boolean; 'caveman-intensity'?: string };
type AttachArgs = { attach?: string | string[]; a?: string | string[] };
type PreferenceSetArgs = PresetArgs & {
  harness?: string;
  model?: string;
  caveman?: string;
  'caveman-intensity'?: string;
};
type PrimordiaServiceName = 'service-supervisor' | 'reverse-proxy' | 'scheduled-jobs';
type SupervisedServiceName = Exclude<PrimordiaServiceName, 'service-supervisor'>;
type ServiceLogArgs = JsonArgs & { lines?: string; n?: string; start?: string; s?: string; follow?: boolean; f?: boolean };
type ServerStatusArgs = JsonArgs & { follow?: boolean; f?: boolean };

const MISSING_CLI_KEY_MESSAGE =
  'PRIMORDIA_CLI_KEY is required for `primordia thread create`, `primordia thread followup`, and `primordia thread accept`. ' +
  'Open Settings → API keys in the web app (/settings/api-keys), create a CLI key, copy the one-time `PRIMORDIA_CLI_KEY=...` value, and export it in this shell before retrying.';

function printJson(context: CommandContext, value: unknown): void {
  context.console.log(JSON.stringify(value, null, 2));
}

function cliSecretError(message: string | undefined, fallback: string): Error {
  const text = message ?? fallback;
  return new Error(text
    .replaceAll('PRIMORDIA_AES_KEY', 'PRIMORDIA_CLI_KEY')
    .replaceAll('Primordia AES key', 'Primordia CLI key')
    .replaceAll('this device’s Primordia AES key', 'a Primordia CLI key'));
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function realpathIfExists(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function resolveCurrentThread(context: CommandContext, report: ProcessStatusReport, cwd = context.process.cwd()): { threadId: string; path: string } {
  const resolvedCwd = realpathIfExists(cwd);
  const matches = report.worktrees
    .map((worktree) => ({ ...worktree, resolvedPath: realpathIfExists(worktree.path) }))
    .filter((worktree) => isPathInside(worktree.resolvedPath, resolvedCwd))
    .sort((a, b) => b.resolvedPath.length - a.resolvedPath.length);

  const match = matches[0];
  if (!match) throw new Error('cwd is not inside a Primordia thread worktree; cd into a thread worktree first');
  if (!match.branch) throw new Error(`cwd is inside detached worktree ${match.path}; cd into a branch-backed thread worktree first`);
  return { threadId: match.branch, path: match.path };
}

function resolveCurrentThreadId(context: CommandContext): string {
  return resolveCurrentThread(context, getProcessStatusReport()).threadId;
}

function resolveStartMode(args: ModeArgs | CliParsedArgs): ServerStartMode {
  if (args.dev && args.prod) throw new Error('--dev and --prod cannot be combined');
  return args.prod ? 'prod' : 'dev';
}

function normalizeStringList(value: string | string[] | boolean | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? [value] : [];
}

function resolveAttachmentPaths(args: AttachArgs): string[] {
  const rawPaths = [...normalizeStringList(args.attach), ...normalizeStringList(args.a)];
  const paths = [...new Set(rawPaths.map((entry) => entry.trim()).filter(Boolean))].map((entry) => path.resolve(entry));
  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) throw new Error(`attachment not found: ${filePath}`);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error(`attachment is not a file: ${filePath}`);
  }
  return paths;
}

function readTextLogLines(logFile: string): string[] {
  if (!fs.existsSync(logFile)) return [];
  const text = fs.readFileSync(logFile, 'utf8');
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

async function* followTextLogLines(logFile: string, signal?: AbortSignal, pollMs = 500): AsyncGenerator<string> {
  let offset = 0;
  try { offset = fs.statSync(logFile).size; } catch { offset = 0; }
  let buffered = '';
  while (!signal?.aborted) {
    try {
      const stat = fs.statSync(logFile);
      if (stat.size < offset) {
        offset = 0;
        buffered = '';
      }
      if (stat.size > offset) {
        const fd = fs.openSync(logFile, 'r');
        const length = stat.size - offset;
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, offset);
        fs.closeSync(fd);
        offset = stat.size;
        buffered += buffer.toString('utf8');
        const parts = buffered.split(/\r?\n/);
        buffered = parts.pop() ?? '';
        for (const line of parts) yield line;
      }
    } catch { /* log may not exist yet */ }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function formatNdjsonLine(line: string, rawNdjson: boolean): string {
  if (rawNdjson) {
    try {
      JSON.parse(line);
      return `${line}\n`;
    } catch {
      return `${JSON.stringify({ type: 'malformed_log_line', line })}\n`;
    }
  }
  return `${JSON.stringify({ type: 'log_line', line })}\n`;
}

function parseSessionEventLine(line: string): SessionEvent | { type: 'malformed_log_line'; line: string } {
  try {
    return JSON.parse(line) as SessionEvent;
  } catch {
    return { type: 'malformed_log_line', line };
  }
}

function compactText(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function inlineText(content: string): string {
  return content.replace(/[ \t\f\v\r]+/g, ' ');
}

function authSourceFromAgentAuth(auth: Extract<SessionEvent, { type: 'section_start'; sectionType: 'agent' }>['auth']): PresetAuthSource {
  if (!auth || auth.source === 'llm-gateway') return 'exe-dev-gateway';
  if (auth.source === 'claude-credentials') return 'claude-subscription';
  if (auth.source === 'chatgpt-subscription') return 'chatgpt-subscription';
  return 'anthropic-api-key';
}

function harnessLabel(harnessIdOrLabel?: string): string {
  if (!harnessIdOrLabel) return 'Claude Code';
  if (harnessIdOrLabel === 'claude-code') return 'Claude Code';
  if (harnessIdOrLabel === 'codex') return 'Codex';
  if (harnessIdOrLabel === 'pi') return 'Pi';
  return harnessIdOrLabel;
}

function formatAgentSectionLabel(event: Extract<SessionEvent, { type: 'section_start'; sectionType: 'agent' }>): string {
  const authLabel = PRESET_AUTH_SOURCE_LABELS[authSourceFromAgentAuth(event.auth)];
  return `\n🤖 ${authLabel} / ${harnessLabel(event.harnessId ?? event.harness)} / ${event.model}`;
}

function formatThinkDuration(startTs: number, endTs: number): string {
  const secs = Math.max(1, Math.ceil((endTs - startTs) / 1000));
  if (secs < 60) return `${secs}s`;
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatToolInput(name: string, input: Record<string, unknown>): string {
  if (typeof input.command === 'string') return input.command;
  for (const key of ['file_path', 'path', 'pattern', 'glob']) {
    if (typeof input[key] === 'string') return input[key];
  }
  if (name.toLowerCase() === 'edit' && Array.isArray(input.edits)) return `${input.edits.length} edit(s)`;
  const entries = Object.entries(input);
  if (entries.length === 0) return '';
  const [key, value] = entries[0];
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `${key}=${text.length > 80 ? `${text.slice(0, 80)}…` : text}`;
}

type HumanLogChunk = string | { text: string; inline?: boolean };
type HumanLogRenderer = {
  format(line: string): HumanLogChunk | null;
  flush(): HumanLogChunk | null;
};

function createSessionHumanRenderer(): HumanLogRenderer {
  let thinkingContent = '';
  let thinkingStartTs: number | null = null;
  let thinkingEndTs: number | null = null;

  const flushThinking = (): HumanLogChunk | null => {
    if (thinkingStartTs === null) return null;
    const content = thinkingContent;
    const startTs = thinkingStartTs;
    const endTs = thinkingEndTs ?? thinkingStartTs;
    thinkingContent = '';
    thinkingStartTs = null;
    thinkingEndTs = null;
    const prefix = `🧠 Thought for ${formatThinkDuration(startTs, endTs)}`;
    return content.trim() ? `${prefix}: ${content.trim()}` : `${prefix} privately`;
  };

  const formatEvent = (event: SessionEvent | { type: 'malformed_log_line'; line: string }): HumanLogChunk | null => {
    if (event.type === 'malformed_log_line') return event.line;
    if (event.type === 'thinking') {
      if (thinkingStartTs === null) thinkingStartTs = event.ts;
      thinkingEndTs = event.ts;
      thinkingContent += event.content;
      return null;
    }

    const flushed = flushThinking();
    const current = (() => {
      switch (event.type) {
        case 'section_start':
          return event.sectionType === 'agent' ? formatAgentSectionLabel(event) : `\n${event.label}`;
        case 'setup_step':
          return event.done ? `✅ ${event.label}` : `• ${event.label}`;
        case 'initial_request':
          return `User asked:\n${event.request.trim()}`;
        case 'followup_request':
          return null;
        case 'text':
        case 'log_line': {
          const text = inlineText(event.content);
          return text ? { text, inline: true } : null;
        }
        case 'tool_use': {
          const summary = formatToolInput(event.name, event.input);
          return `🔧 ${event.name}${summary ? `: ${summary}` : ''}`;
        }
        case 'result':
          return `${event.subtype === 'success' ? '✅' : '❌'} ${event.message ? compactText(event.message) : event.subtype}`;
        case 'metrics':
          return null;
        case 'progress_plan':
          return event.steps.length > 0 ? `Plan: ${event.steps.map((step) => step.label).join(' → ')}` : null;
        case 'progress_step':
          return event.status === 'done'
            ? `✅ Completed step${event.activatedNextLabel ? `; next: ${event.activatedNextLabel}` : ''}`
            : `❌ Step failed${event.activatedNextLabel ? `; next: ${event.activatedNextLabel}` : ''}`;
        case 'preview_path':
          return `Preview: ${event.path}`;
        case 'decision':
          return `${event.action === 'accepted' ? 'Accepted' : 'Rejected'}: ${event.detail}`;
        default:
          return null;
      }
    })();

    if (!flushed) return current;
    if (!current) return flushed;
    return `${typeof flushed === 'string' ? flushed : flushed.text}\n${typeof current === 'string' ? current : current.text}`;
  };

  return {
    format(line: string): HumanLogChunk | null {
      return formatEvent(parseSessionEventLine(line));
    },
    flush: flushThinking,
  };
}

function createFollowAbortSignal(context: CommandContext, cleanup?: () => void): AbortSignal {
  const controller = new AbortController();
  const abort = () => {
    cleanup?.();
    controller.abort();
  };

  if (context.process.abortSignal) {
    if (context.process.abortSignal.aborted) abort();
    else context.process.abortSignal.addEventListener('abort', abort, { once: true });
  }

  // CLI callers keep stdin connected to the terminal/client lifecycle. If the
  // client disconnects or the dev/prod server dies, stdin closes; a --follow
  // command must then exit instead of becoming an orphan adopted by PID 1.
  if (!context.process.stdin.isTTY) {
    context.process.stdin.resume();
    context.process.stdin.once('end', abort);
    context.process.stdin.once('close', abort);
    context.process.stdin.once('error', abort);
  }
  context.process.stdout.once('error', abort);
  context.process.stderr.once('error', abort);
  context.process.onSignal('SIGTERM', abort);
  context.process.onSignal('SIGINT', abort);
  return controller.signal;
}

async function renderLogFile(context: CommandContext, logFile: string, args: ServiceLogArgs, options: { rawNdjson?: boolean; humanFormatter?: (line: string) => HumanLogChunk | null; humanRenderer?: HumanLogRenderer } = {}): Promise<void> {
  const startLine = resolveLogStartLine(args);
  const lineCount = resolveLogLineCount(args, startLine);
  const follow = Boolean(args.follow || args.f);
  const allLines = readTextLogLines(logFile);
  const selectedLines = selectLogLines(allLines, lineCount, startLine);

  if (args.json) {
    for (const line of selectedLines) context.process.stdout.write(formatNdjsonLine(line, Boolean(options.rawNdjson)));
    if (follow) {
      for await (const line of followTextLogLines(logFile, createFollowAbortSignal(context))) context.process.stdout.write(formatNdjsonLine(line, Boolean(options.rawNdjson)));
    }
    return;
  }

  const renderer = options.humanRenderer;
  const formatter = renderer ? renderer.format : (options.humanFormatter ?? ((line: string) => line));
  let inlineOpen = false;
  const writeFormatted = (formatted: HumanLogChunk | null): void => {
    if (!formatted) return;
    if (typeof formatted === 'object' && formatted.inline) {
      context.process.stdout.write(formatted.text);
      inlineOpen = true;
      return;
    }
    if (inlineOpen) context.process.stdout.write('\n');
    const text = typeof formatted === 'string' ? formatted : formatted.text;
    context.console.log(text);
    inlineOpen = false;
  };

  for (const line of selectedLines) writeFormatted(formatter(line));
  if (follow) {
    for await (const line of followTextLogLines(logFile, createFollowAbortSignal(context))) writeFormatted(formatter(line));
  }
  if (renderer) writeFormatted(renderer.flush());
  if (inlineOpen) context.process.stdout.write('\n');
}

async function renderServerLogs(context: CommandContext, threadId: string, args: ServiceLogArgs): Promise<void> {
  await renderLogFile(context, getWorktreeServerLogPath(threadId), args);
}

function getWorktreeServerLogPath(threadId: string): string {
  const report = getProcessStatusReport();
  const worktree = report.worktrees.find((entry) => entry.branch === threadId);
  if (!worktree) throw new Error(`Unknown thread/worktree: ${threadId}`);
  return path.join(worktree.path, '.primordia-next-server.log');
}

async function readRequest(context: CommandContext, args: CliParsedArgs): Promise<string> {
  const parts = args._.length > 0 ? args._ : typeof args.request === 'string' ? [args.request] : [];
  if (parts.length === 0) throw new Error('request text required');
  if (parts.length === 1 && parts[0] === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of context.process.stdin) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) throw new Error('stdin request text is empty');
    return text;
  }
  return parts.join(' ').trim();
}

async function resolveCliAuth(context: CommandContext, selector: string | undefined): Promise<{ user: { id: string; username: string }; primordiaAesKey: string }> {
  const coreUserId = context.process.env.PRIMORDIA_CORE_USER_ID;
  const coreAesKey = context.process.env.PRIMORDIA_CORE_AES_KEY ?? '';
  if (coreUserId) {
    if (selector && selector !== coreUserId) {
      const selected = await resolveCliUser(selector);
      if (selected.id !== coreUserId) throw new Error('The authenticated Primordia Core web key belongs to a different user than --user.');
      return { user: selected, primordiaAesKey: coreAesKey };
    }
    const db = await getDb();
    const user = await db.getUserById(coreUserId);
    if (!user) throw new Error('The authenticated Primordia Core web key refers to a user that no longer exists.');
    return { user, primordiaAesKey: coreAesKey };
  }

  const rawCliKey = context.process.env.PRIMORDIA_CLI_KEY;
  if (!rawCliKey) {
    throw new Error(MISSING_CLI_KEY_MESSAGE);
  }

  const resolved = await resolvePrimordiaCliKey(rawCliKey, 'cli');
  if (selector && selector !== resolved.userId) {
    const selected = await resolveCliUser(selector);
    if (selected.id !== resolved.userId) {
      throw new Error('PRIMORDIA_CLI_KEY belongs to a different Primordia user than --user. Create a CLI key for that user or omit --user.');
    }
    return { user: selected, primordiaAesKey: resolved.aesKeyJwkJson };
  }
  const db = await getDb();
  const user = await db.getUserById(resolved.userId);
  if (!user) throw new Error('PRIMORDIA_CLI_KEY refers to a user that no longer exists.');
  return { user, primordiaAesKey: resolved.aesKeyJwkJson };
}

async function resolveCliUser(selector: string | undefined): Promise<{ id: string; username: string }> {
  const db = await getDb();
  const user = selector
    ? ((await db.getUserById(selector)) ?? (await db.getUserByUsername(selector)))
    : null;
  if (user) return user;
  if (selector) throw new Error(`Primordia user not found: ${selector}`);

  const users = await db.getAllUsers();
  if (users.length === 1) return users[0];
  if (users.length === 0) throw new Error('No Primordia users exist yet. Sign in through the web app first.');
  throw new Error('Multiple Primordia users exist; pass --user <id-or-username>.');
}

function rejectUnexpectedRequestText(args: CliParsedArgs, command: string): void {
  if (args._.length > 0) throw new Error(`${command} does not accept request text`);
}

function getCurrentThread(context: CommandContext): { threadId: string; path: string } {
  return resolveCurrentThread(context, getProcessStatusReport());
}

function resolveJobName(args: CliParsedArgs): PrimordiaJobName {
  const value = String(args._[0] ?? args.job ?? '');
  if (!isPrimordiaJobName(value)) throw new Error(`Unknown Primordia job: ${value || '(missing)'}`);
  return value;
}

function scheduleRows(context: CommandContext, repoRoot = context.process.cwd()) {
  return listJobSchedules(repoRoot).map((schedule) => ({
    name: schedule.name,
    intervalMs: schedule.intervalMs,
    interval: formatJobInterval(schedule.intervalMs),
    defaultIntervalMs: schedule.defaultIntervalMs,
    defaultInterval: formatJobInterval(schedule.defaultIntervalMs),
    gitConfigKey: schedule.gitConfigKey,
  }));
}

function printScheduleTable(context: CommandContext, rows: ReturnType<typeof scheduleRows>): void {
  const nameWidth = Math.max('job'.length, ...rows.map((row) => row.name.length));
  const intervalWidth = Math.max('interval'.length, ...rows.map((row) => row.interval.length));
  context.console.log(`${'job'.padEnd(nameWidth)}  ${'interval'.padEnd(intervalWidth)}  git config`);
  for (const row of rows) context.console.log(`${row.name.padEnd(nameWidth)}  ${row.interval.padEnd(intervalWidth)}  ${row.gitConfigKey}`);
}

function serviceSignal(service: SupervisedServiceName): NodeJS.Signals {
  return service === 'reverse-proxy' ? 'SIGUSR1' : 'SIGUSR2';
}

type SystemctlVia = 'systemd' | 'sudo-systemd';

function sudoSupportsNonInteractive(): boolean {
  try {
    execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runSystemctl(context: CommandContext, args: string[], options: { allowSudo?: boolean; interactiveSudo?: boolean } = {}): SystemctlVia | null {
  try {
    execFileSync('systemctl', args, { stdio: 'ignore' });
    return 'systemd';
  } catch {
    // Fall through to sudo below. Some production installs run the CLI as the
    // unprivileged Primordia user; direct `systemctl restart primordia` fails
    // there even though the installer has just used sudo successfully.
  }

  if (!options.allowSudo) return null;
  const sudoArgs = options.interactiveSudo && context.process.stdin.isTTY ? [] : ['-n'];
  try {
    execFileSync('sudo', [...sudoArgs, 'systemctl', ...args], { stdio: 'ignore' });
    return 'sudo-systemd';
  } catch {
    return null;
  }
}

function signalSupervisorViaSystemd(context: CommandContext, signal: NodeJS.Signals): SystemctlVia | null {
  const unit = context.process.env.PRIMORDIA_SERVICE_UNIT || 'primordia';
  const activeVia = runSystemctl(context, ['is-active', '--quiet', unit]);
  if (!activeVia) return null;
  return runSystemctl(context, ['kill', '--kill-whom=main', `--signal=${signal}`, unit], { allowSudo: sudoSupportsNonInteractive() });
}

function signalSupervisorViaPgrep(context: CommandContext, signal: NodeJS.Signals): number[] {
  let output = '';
  try {
    output = execFileSync('pgrep', ['-f', 'service-supervisor\\.(js|ts)'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return [];
  }
  const pids = output
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== context.process.pid);
  for (const pid of pids) context.process.kill(pid, signal);
  return pids;
}

function restartServiceSupervisor(context: CommandContext, json: boolean | undefined): void {
  const unit = context.process.env.PRIMORDIA_SERVICE_UNIT || 'primordia';
  const via = runSystemctl(context, ['restart', unit], { allowSudo: true, interactiveSudo: !json });
  if (!via) {
    throw new Error(
      `Could not restart ${unit}; service-supervisor restart requires systemd access. ` +
      'Run with sudo, configure passwordless sudo for systemctl, or restart the primordia service manually.',
    );
  }
  const result = { ok: true, service: 'service-supervisor', action: 'restart', via };
  if (json) printJson(context, result);
  else context.console.log(`Restarted service-supervisor via ${via}.`);
}

function restartSupervisedService(context: CommandContext, service: SupervisedServiceName, json: boolean | undefined): void {
  const signal = serviceSignal(service);
  const viaSystemd = signalSupervisorViaSystemd(context, signal);
  const pids = viaSystemd ? [] : signalSupervisorViaPgrep(context, signal);
  if (!viaSystemd && pids.length === 0) throw new Error('Primordia service-supervisor is not running or could not be signaled');
  const result = { ok: true, service, action: 'restart', signal, via: viaSystemd ?? 'process', pids };
  if (json) printJson(context, result);
  else context.console.log(`Signaled ${service} restart via ${result.via} (${signal}).`);
}

export async function completeUsers(): Promise<string[]> {
  const db = await getDb();
  const users = await db.getAllUsers();
  return users.flatMap((user) => [user.username, user.id]);
}

export function completeJobNames(): string[] {
  return listJobSchedules().map((schedule) => schedule.name);
}

export function completeModelIds(): string[] {
  return [...new Set(Object.values(MODEL_OPTIONS).flatMap((models) => models.map((model) => model.id)))];
}

export function statusCommand(context: CommandContext, args: CliParsedArgs & JsonArgs): void {
  const report = getProcessStatusReport();
  if (args.json) printJson(context, report);
  else context.console.log(formatProcessStatusReport(report));
}

export async function jobsRunCommand(context: CommandContext, args: CliParsedArgs & JsonArgs): Promise<void> {
  const listenPort = Number.parseInt(context.process.env.REVERSE_PROXY_PORT ?? '', 10);
  const started = runPrimordiaJobs({
    repoRoot: context.process.cwd(),
    listenPort: Number.isFinite(listenPort) ? listenPort : undefined,
    archiveRoot: context.process.env.PRIMORDIA_DIR,
  });
  if (args.json) printJson(context, { ok: started, command: 'jobs run', schedules: scheduleRows(context) });
  else context.console.log(started ? 'Primordia jobs daemon running. Press Ctrl-C to stop.' : 'Another Primordia jobs scheduler is already running.');
  if (!started) return;
  await new Promise(() => { /* keep daemon alive */ });
}

export async function jobsRunOneCommand(context: CommandContext, args: CliParsedArgs & JsonArgs): Promise<void> {
  const job = resolveJobName(args);
  const result = await runPrimordiaJobOnce(job, { repoRoot: context.process.cwd() });
  if (args.json) printJson(context, result);
  else context.console.log(`${result.ok ? 'ok' : 'failed'}: ${result.summary}`);
  if (!result.ok) context.process.exit(1);
}

function serviceLogFile(context: CommandContext, service: SupervisedServiceName): string {
  const root = context.process.env.PRIMORDIA_DIR || context.process.cwd();
  return path.join(root, service === 'reverse-proxy' ? '.primordia-reverse-proxy.log' : '.primordia-scheduled-jobs.log');
}

function resolveLogLineCount(args: ServiceLogArgs, startLine: number | null): number {
  const raw = args.lines ?? args.n;
  if (raw === undefined) return startLine === null ? 100 : Number.POSITIVE_INFINITY;
  const count = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(count) || count < 0) throw new Error('--lines/-n must be a non-negative integer');
  return count;
}

function resolveLogStartLine(args: ServiceLogArgs): number | null {
  const raw = args.start ?? args.s;
  if (raw === undefined) return null;
  const line = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(line) || line < 1) throw new Error('--start/-s must be a positive 1-based line number');
  return line;
}

function selectLogLines(lines: string[], lineCount: number, startLine: number | null): string[] {
  if (lineCount === 0) return [];
  if (startLine === null) return lines.slice(-lineCount);
  return lines.slice(startLine - 1, startLine - 1 + lineCount);
}

async function renderServiceLog(context: CommandContext, service: SupervisedServiceName, args: ServiceLogArgs): Promise<void> {
  await renderLogFile(context, serviceLogFile(context, service), args);
}

export function systemdServiceSupervisorRestartCommand(context: CommandContext, args: CliParsedArgs & JsonArgs): void {
  restartServiceSupervisor(context, args.json);
}

export function reverseProxyRestartCommand(context: CommandContext, args: CliParsedArgs & JsonArgs): void {
  restartSupervisedService(context, 'reverse-proxy', args.json);
}

export async function reverseProxyLogsCommand(context: CommandContext, args: CliParsedArgs & ServiceLogArgs): Promise<void> {
  await renderServiceLog(context, 'reverse-proxy', args);
}

export function jobsRestartCommand(context: CommandContext, args: CliParsedArgs & JsonArgs): void {
  restartSupervisedService(context, 'scheduled-jobs', args.json);
}

export async function jobsLogsCommand(context: CommandContext, args: CliParsedArgs & ServiceLogArgs): Promise<void> {
  await renderServiceLog(context, 'scheduled-jobs', args);
}

export function jobsScheduleListCommand(context: CommandContext, args: CliParsedArgs & JsonArgs): void {
  const rows = scheduleRows(context);
  if (args.json) printJson(context, { schedules: rows });
  else printScheduleTable(context, rows);
}

export function jobsScheduleGetCommand(context: CommandContext, args: CliParsedArgs & JsonArgs): void {
  const job = resolveJobName(args);
  const row = scheduleRows(context).find((schedule) => schedule.name === job)!;
  if (args.json) printJson(context, row);
  else context.console.log(`${row.name}: ${row.interval} (${row.intervalMs}ms)`);
}

export function jobsScheduleSetCommand(context: CommandContext, args: CliParsedArgs & JsonArgs): void {
  const job = resolveJobName(args);
  const intervalValue = String(args._[1] ?? args.interval ?? '');
  if (!intervalValue) throw new Error('interval required');
  const updated = setJobScheduleInterval(job, parseJobInterval(intervalValue));
  const row = {
    name: updated.name,
    intervalMs: updated.intervalMs,
    interval: formatJobInterval(updated.intervalMs),
    defaultIntervalMs: updated.defaultIntervalMs,
    defaultInterval: formatJobInterval(updated.defaultIntervalMs),
    gitConfigKey: updated.gitConfigKey,
  };
  if (args.json) printJson(context, row);
  else context.console.log(`${row.name}: ${row.interval} (${row.gitConfigKey})`);
}

function parseCliBoolean(value: string | undefined, optionName: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true' || value === '1' || value === 'yes' || value === 'on') return true;
  if (value === 'false' || value === '0' || value === 'no' || value === 'off') return false;
  throw new Error(`--${optionName} must be true or false`);
}

function validateHarness(value: string): string {
  if (!HARNESS_OPTIONS.some((harness) => harness.id === value)) {
    throw new Error(`Unknown harness: ${value}. Expected one of: ${HARNESS_OPTIONS.map((harness) => harness.id).join(', ')}`);
  }
  return value;
}

function validateModelForHarness(harness: string, model: string): string {
  const models = MODEL_OPTIONS[harness] ?? [];
  if (!models.some((candidate) => candidate.id === model)) {
    throw new Error(`Unknown model for ${harness}: ${model}`);
  }
  return model;
}

function validateCavemanIntensity(value: string): string {
  if (!(CAVEMAN_INTENSITIES as readonly string[]).includes(value)) {
    throw new Error(`Unknown caveman intensity: ${value}. Expected one of: ${CAVEMAN_INTENSITIES.join(', ')}`);
  }
  return value;
}

async function resolveAndValidatePreferencePreset(userId: string, cliPresetId: string): Promise<string> {
  const resolvedPreset = await resolveCliPresetIdForUser(userId, cliPresetId);
  if (!resolvedPreset) throw new Error('preset required');
  const db = await getDb();
  const prefs = await db.getUserPreferences(userId, [PREF_CUSTOM_PRESETS]);
  const customPresets = parseCustomPresets(prefs[PREF_CUSTOM_PRESETS]);
  const exists = [...BUILT_IN_PRESETS, ...customPresets].some((preset) => preset.id === resolvedPreset);
  if (!exists) throw new Error(`Preset not found: ${cliPresetId}`);
  return resolvedPreset;
}

export async function preferencesGetCommand(context: CommandContext, args: CliParsedArgs & JsonArgs & UserSelectorArgs): Promise<void> {
  rejectUnexpectedRequestText(args, 'preferences get');
  const user = await resolveCliUser(args.user);
  const db = await getDb();
  const [raw, effective] = await Promise.all([
    db.getUserPreferences(user.id, [PREF_PRESET, PREF_HARNESS, PREF_MODEL, PREF_CAVEMAN, PREF_CAVEMAN_INTENSITY]),
    getThreadPrefs(user.id),
  ]);
  const result = {
    user,
    preferences: {
      preferredPreset: raw[PREF_PRESET] ?? null,
      preferredHarness: raw[PREF_HARNESS] ?? null,
      preferredModel: raw[PREF_MODEL] ?? null,
      cavemanMode: raw[PREF_CAVEMAN] ?? null,
      cavemanIntensity: raw[PREF_CAVEMAN_INTENSITY] ?? null,
    },
    effectiveThreadFormDefaults: effective,
  };
  if (args.json) printJson(context, result);
  else {
    context.console.log(`User: ${user.username} (${user.id})`);
    context.console.log(`preferred preset: ${result.preferences.preferredPreset ?? '(not set)'}`);
    context.console.log(`fallback harness: ${result.effectiveThreadFormDefaults.initialHarness}`);
    context.console.log(`fallback model: ${result.effectiveThreadFormDefaults.initialModel}`);
    context.console.log(`caveman mode: ${result.effectiveThreadFormDefaults.initialCavemanMode}`);
    context.console.log(`caveman intensity: ${result.effectiveThreadFormDefaults.initialCavemanIntensity}`);
  }
}

export async function preferencesSetCommand(context: CommandContext, args: CliParsedArgs & JsonArgs & UserSelectorArgs & PreferenceSetArgs): Promise<void> {
  rejectUnexpectedRequestText(args, 'preferences set');
  const user = await resolveCliUser(args.user);
  const updates: Record<string, string> = {};

  if (args.preset !== undefined) {
    updates[PREF_PRESET] = await resolveAndValidatePreferencePreset(user.id, args.preset);
  }

  const currentPrefs = await getThreadPrefs(user.id);
  const nextHarness = args.harness !== undefined ? validateHarness(args.harness) : currentPrefs.initialHarness;
  if (args.harness !== undefined) updates[PREF_HARNESS] = nextHarness;
  if (args.model !== undefined) updates[PREF_MODEL] = validateModelForHarness(nextHarness, args.model);

  const cavemanMode = parseCliBoolean(args.caveman, 'caveman');
  if (cavemanMode !== undefined) updates[PREF_CAVEMAN] = String(cavemanMode);
  if (args['caveman-intensity'] !== undefined) updates[PREF_CAVEMAN_INTENSITY] = validateCavemanIntensity(args['caveman-intensity']);

  if (Object.keys(updates).length === 0) {
    throw new Error('No preferences supplied. Use one or more of --preset, --harness, --model, --caveman, or --caveman-intensity.');
  }

  const db = await getDb();
  await db.setUserPreferences(user.id, updates);
  const effective = await getThreadPrefs(user.id);
  const result = { ok: true, user, updated: updates, effectiveThreadFormDefaults: effective };
  if (args.json) printJson(context, result);
  else {
    context.console.log(`Updated preferences for ${user.username}.`);
    for (const [key, value] of Object.entries(updates)) context.console.log(`${key}: ${value}`);
  }
}

function getServerStatus(threadId: string): { threadId: string; status: 'running' | 'stopped' | 'unknown' } {
  const worktree = getProcessStatusReport().worktrees.find((entry) => entry.branch === threadId);
  return {
    threadId,
    status: !worktree ? 'unknown' : worktree.servers.length > 0 ? 'running' : 'stopped',
  };
}

function formatServerStatus(snapshot: ReturnType<typeof getServerStatus>, json: boolean): string {
  return json ? JSON.stringify(snapshot) : `${snapshot.threadId}: ${snapshot.status}`;
}

export async function serverStatusCommand(context: CommandContext, args: CliParsedArgs & ServerStatusArgs): Promise<void> {
  const thread = getCurrentThread(context);
  let previous = '';
  do {
    const snapshot = getServerStatus(thread.threadId);
    const serialized = JSON.stringify(snapshot);
    if (serialized !== previous) {
      context.console.log(formatServerStatus(snapshot, Boolean(args.json)));
      previous = serialized;
    }
    if (!(args.follow || args.f)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (true);
}

export async function serverStartCommand(context: CommandContext, args: CliParsedArgs): Promise<void> {
  const thread = getCurrentThread(context);
  const result = await startWorktreeServer(thread.threadId, resolveStartMode(args));
  if (args.json) printJson(context, result);
  else context.console.log(result.message);
}

export async function serverStopCommand(context: CommandContext, args: CliParsedArgs): Promise<void> {
  const thread = getCurrentThread(context);
  const result = await stopWorktreeServer(thread.threadId);
  if (args.json) printJson(context, result);
  else context.console.log(result.message);
}

export async function serverRestartCommand(context: CommandContext, args: CliParsedArgs): Promise<void> {
  const thread = getCurrentThread(context);
  const result = await restartWorktreeServer(thread.threadId, resolveStartMode(args));
  if (args.json) printJson(context, result);
  else context.console.log(result.message);
}

export async function serverLogsCommand(context: CommandContext, args: CliParsedArgs & ServiceLogArgs): Promise<void> {
  const thread = getCurrentThread(context);
  await renderServerLogs(context, thread.threadId, args);
}

export async function threadLogsCommand(context: CommandContext, args: CliParsedArgs & ServiceLogArgs): Promise<void> {
  const thread = getCurrentThread(context);
  await renderLogFile(context, path.join(thread.path, '.primordia-session.ndjson'), args, {
    rawNdjson: true,
    humanRenderer: createSessionHumanRenderer(),
  });
}

export async function serverPublishCommand(context: CommandContext, args: CliParsedArgs): Promise<void> {
  const thread = getCurrentThread(context);
  const result = await publishProductionBranch(thread.threadId);
  if (args.json) printJson(context, result);
  else context.console.log(result.message);
}

export async function serverCopyDbCommand(context: CommandContext, args: CliParsedArgs): Promise<void> {
  const thread = getCurrentThread(context);
  const result = await copyProductionDbToWorktree(context.process.cwd(), thread.path);
  if (args.json) {
    printJson(context, result);
  } else if (result.copied) {
    context.console.log(`Copied production DB from ${result.sourcePath} to ${result.destinationPath}`);
  } else {
    context.console.error(`Failed to copy production DB to ${result.destinationPath}: ${result.error ?? 'unknown error'}`);
  }
  if (!result.copied) context.process.exit(1);
}

export async function threadCreateCommand(context: CommandContext, args: CliParsedArgs & JsonArgs & PresetArgs & CavemanArgs & UserSelectorArgs & AttachArgs): Promise<void> {
  const requestText = await readRequest(context, args);
  const { user, primordiaAesKey } = await resolveCliAuth(context, args.user);
  const cavemanEnabled = args.caveman === true || args.caveman === 'true';
  const cavemanIntensity = typeof args['caveman-intensity'] === 'string' && (CAVEMAN_INTENSITIES as readonly string[]).includes(args['caveman-intensity'])
    ? args['caveman-intensity'] as (typeof CAVEMAN_INTENSITIES)[number]
    : undefined;
  const result = await createThread({
    userId: user.id,
    requestText,
    presetId: await resolveCliPresetIdForUser(user.id, args.preset),
    primordiaAesKey,
    savedAttachmentPaths: resolveAttachmentPaths(args),
    cavemanMode: cavemanEnabled,
    ...(cavemanIntensity ? { cavemanIntensity } : {}),
    runInBackground: false,
  });
  if (!result.ok) throw cliSecretError(result.error, `thread creation failed (${result.status})`);
  if (args.json) printJson(context, { ok: true, command: 'thread create', threadId: result.sessionId, worktreePath: result.worktreePath, background: true });
  else context.console.log(`New thread started in ${result.worktreePath}`);
}

export async function threadFollowupCommand(context: CommandContext, args: CliParsedArgs & JsonArgs & PresetArgs & UserSelectorArgs & AttachArgs): Promise<void> {
  const requestText = await readRequest(context, args);
  const { user, primordiaAesKey } = await resolveCliAuth(context, args.user);
  const threadId = resolveCurrentThreadId(context);
  const result = await followupThread({
    userId: user.id,
    threadId,
    requestText,
    presetId: await resolveCliPresetIdForUser(user.id, args.preset),
    primordiaAesKey,
    attachmentPaths: resolveAttachmentPaths(args),
    runInBackground: false,
  });
  if (!result.ok) throw cliSecretError(result.error, 'follow-up failed');
  if (args.json) printJson(context, { ok: true, command: 'thread followup', thread: threadId, background: true });
  else context.console.log(`Follow-up started for ${threadId}.`);
}

export async function threadUpdateCommand(context: CommandContext, args: CliParsedArgs & JsonArgs & UserSelectorArgs): Promise<void> {
  rejectUnexpectedRequestText(args, 'update');
  const user = await resolveCliUser(args.user);
  const threadId = resolveCurrentThreadId(context);
  const result = await updateThread({ userId: user.id, threadId });
  if (!result.ok) throw new Error(result.error);
  if (args.json) printJson(context, { ok: true, command: 'thread update', thread: threadId, outcome: result.outcome, log: result.log });
  else {
    context.console.log(`Updated ${threadId}: ${result.outcome}.`);
    if (result.log.trim()) context.console.log(result.log.trim());
  }
}

async function handleDecision(context: CommandContext, args: CliParsedArgs & JsonArgs & UserSelectorArgs, action: 'accept' | 'reject'): Promise<void> {
  rejectUnexpectedRequestText(args, action);
  const auth = action === 'accept'
    ? await resolveCliAuth(context, args.user)
    : { user: await resolveCliUser(args.user), primordiaAesKey: null };
  const threadId = resolveCurrentThreadId(context);
  const result = await manageThread({
    userId: auth.user.id,
    threadId,
    action,
    primordiaAesKey: auth.primordiaAesKey,
  });
  if (!result.ok) throw cliSecretError(result.error, 'thread decision failed');
  if (args.json) printJson(context, { ok: true, command: `thread ${action}`, thread: threadId, outcome: result.outcome });
  else context.console.log(`${action === 'accept' ? 'Accept' : 'Reject'} started for ${threadId}: ${result.outcome}.`);
}

export function threadAcceptCommand(context: CommandContext, args: CliParsedArgs & JsonArgs & UserSelectorArgs): Promise<void> {
  return handleDecision(context, args, 'accept');
}

export function threadRejectCommand(context: CommandContext, args: CliParsedArgs & JsonArgs & UserSelectorArgs): Promise<void> {
  return handleDecision(context, args, 'reject');
}


const commandHandlers = {
  statusCommand, jobsRunCommand, jobsRunOneCommand, systemdServiceSupervisorRestartCommand, reverseProxyRestartCommand, reverseProxyLogsCommand, jobsRestartCommand, jobsLogsCommand, jobsScheduleListCommand, jobsScheduleGetCommand, jobsScheduleSetCommand, preferencesGetCommand, preferencesSetCommand, serverStatusCommand, serverStartCommand, serverStopCommand, serverRestartCommand, serverLogsCommand, threadLogsCommand, serverPublishCommand, serverCopyDbCommand, threadCreateCommand, threadFollowupCommand, threadUpdateCommand, threadAcceptCommand, threadRejectCommand,
};

const jsonOption: CliOptionDef = {
  name: 'json',
  type: 'boolean',
  description: 'Print machine-formatted output instead of human-readable output. Log commands use NDJSON.',
};

const devOption: CliOptionDef = {
  name: 'dev',
  type: 'boolean',
  description: 'Start with bun run dev. This is the default.',
};

const prodOption: CliOptionDef = {
  name: 'prod',
  type: 'boolean',
  description: 'Start with bun run start.',
};

const userOption: CliOptionDef = {
  name: 'user',
  type: 'string',
  valueHint: 'id-or-username',
  description: 'Primordia user id or username for thread commands.',
  complete() {
    return completeUsers();
  },
};

const BUILT_IN_CLI_PRESET_IDS = [
  'claude-code-gateway',
  'claude-code-subscription',
  'claude-code-api-key',
  'codex-gateway',
  'codex-chatgpt',
  'codex-openai-api-key',
  'pi-chatgpt-codex-mini',
  'pi-openrouter-sonnet',
  'pi-openrouter-gemini-flash',
  'pi-gemini-flash',
  'free-option',
];

const presetOption: CliOptionDef = {
  name: 'preset',
  type: 'string',
  valueHint: 'preset',
  description: "Preset id. Built-in presets omit the 'builtin:' prefix. Defaults to the user's saved preset when available.",
  complete(context) {
    return completeCliPresetIds(context).catch(() => BUILT_IN_CLI_PRESET_IDS);
  },
};

const harnessOption: CliOptionDef = {
  name: 'harness',
  type: 'string',
  valueHint: 'harness',
  description: 'Preferred fallback harness for the thread form: claude-code, pi, or codex.',
  complete() {
    return ['claude-code', 'pi', 'codex'];
  },
};

const modelOption: CliOptionDef = {
  name: 'model',
  type: 'string',
  valueHint: 'model',
  description: 'Preferred fallback model id for the selected harness.',
  complete() {
    return completeModelIds();
  },
};

const cavemanOption: CliOptionDef = {
  name: 'caveman',
  type: 'string',
  valueHint: 'true|false',
  description: 'Whether caveman mode should be enabled by default in thread forms.',
  complete() {
    return ['true', 'false'];
  },
};

const cavemanIntensityOption: CliOptionDef = {
  name: 'caveman-intensity',
  type: 'string',
  valueHint: 'intensity',
  description: 'Default caveman intensity: lite, full, ultra, wenyan-lite, wenyan-full, or wenyan-ultra.',
  complete() {
    return ['lite', 'full', 'ultra', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra'];
  },
};

const followOption: CliOptionDef = {
  name: 'follow',
  alias: 'f',
  type: 'boolean',
  description: 'Keep streaming appended log lines.',
};

const linesOption: CliOptionDef = {
  name: 'lines',
  alias: 'n',
  type: 'string',
  valueHint: 'count',
  description: 'Number of recent log lines to print. With --start, this limits how many lines to print from the cursor.',
};

const startLineOption: CliOptionDef = {
  name: 'start',
  alias: 's',
  type: 'string',
  valueHint: 'line',
  description: 'Print log lines starting at 1-based line number N instead of tailing recent lines.',
};

const attachOption: CliOptionDef = {
  name: 'attach',
  alias: 'a',
  type: 'string',
  valueHint: 'file',
  description: 'Attach a file to the thread request. May be provided multiple times.',
  multiple: true,
};

const requestArgument: CliArgumentDef = {
  name: 'request',
  required: false,
  valueHint: 'request',
  description: "Change request text. Pass '-' to read it from stdin.",
};

const jobNameArgument: CliArgumentDef = {
  name: 'job',
  required: true,
  valueHint: 'job',
  description: 'Job name: update-sources, dependency-audit, leak-diagnostics, or disk-cleanup.',
  complete() {
    return completeJobNames();
  },
};

const intervalArgument: CliArgumentDef = {
  name: 'interval',
  required: true,
  valueHint: 'interval',
  description: 'Interval such as 60000, 60s, 5m, 1h, or 1d.',
};

function lazyRun(name: keyof typeof commandHandlers) {
  return async ({ args, context }: { args: CliParsedArgs; context: CommandContext }) => {
    const handler = commandHandlers[name] as (context: CommandContext, args: CliParsedArgs) => unknown | Promise<unknown>;
    return handler(context, args);
  };
}

const statusCommandDef: CliCommandDef = {
  name: 'status',
  description: 'List reverse proxy, threads, Next.js servers, and active agents.',
  options: [jsonOption],
  api: { path: '/status', method: 'GET' },
  run: lazyRun('statusCommand'),
};

const serverStatusCommandDef: CliCommandDef = {
  name: 'status',
  description: "Show the current thread's server status. With --follow --json, emit an NDJSON update whenever it changes.",
  options: [jsonOption, followOption],
  api: { path: '/server/[threadId]/status', method: 'GET', streaming: true, cwdParam: 'threadId' },
  run: lazyRun('serverStatusCommand'),
};

const startCommandDef: CliCommandDef = {
  name: 'start',
  description: "Start the thread's Next.js server.",
  options: [jsonOption, devOption, prodOption],
  api: { path: '/server/[threadId]/start', cwdParam: 'threadId' },
  run: lazyRun('serverStartCommand'),
};

const stopCommandDef: CliCommandDef = {
  name: 'stop',
  description: "Stop the thread's active server process(es).",
  options: [jsonOption],
  api: { path: '/server/[threadId]/stop', cwdParam: 'threadId' },
  run: lazyRun('serverStopCommand'),
};

const restartCommandDef: CliCommandDef = {
  name: 'restart',
  description: "Stop, then start, the thread's server.",
  options: [jsonOption, devOption, prodOption],
  api: { path: '/server/[threadId]/restart', cwdParam: 'threadId' },
  run: lazyRun('serverRestartCommand'),
};

const logsCommandDef: CliCommandDef = {
  name: 'logs',
  description: "Print the thread's server log file. With --json, emits NDJSON records wrapping each log line.",
  options: [jsonOption, linesOption, startLineOption, followOption],
  api: { path: '/server/[threadId]/logs', method: 'GET', streaming: true, cwdParam: 'threadId' },
  run: lazyRun('serverLogsCommand'),
};

const publishCommandDef: CliCommandDef = {
  name: 'publish',
  description: "Health-check the thread's server, then promote it to production.",
  options: [jsonOption],
  api: { path: '/server/[threadId]/publish', cwdParam: 'threadId' },
  run: lazyRun('serverPublishCommand'),
};

const copyDbCommandDef: CliCommandDef = {
  name: 'copydb',
  description: 'Safely copy the production SQLite DB into the thread.',
  options: [jsonOption],
  api: { path: '/server/[threadId]/copydb', cwdParam: 'threadId' },
  run: lazyRun('serverCopyDbCommand'),
};

const createCommandDef: CliCommandDef = {
  name: 'create',
  description: 'Create a thread and run its initial agent turn.',
  options: [jsonOption, userOption, presetOption, cavemanOption, cavemanIntensityOption, attachOption],
  arguments: [requestArgument],
  api: { path: '/thread', multipart: true },
  run: lazyRun('threadCreateCommand'),
};

const followupCommandDef: CliCommandDef = {
  name: 'followup',
  description: 'Run a follow-up request on the current thread.',
  options: [jsonOption, userOption, presetOption, attachOption],
  arguments: [requestArgument],
  api: { path: '/thread/[threadId]/followup', multipart: true, cwdParam: 'threadId' },
  run: lazyRun('threadFollowupCommand'),
};

const threadLogsCommandDef: CliCommandDef = {
  name: 'logs',
  description: "Print the thread's session log in a human-readable form. With --json, emits raw NDJSON events.",
  options: [jsonOption, linesOption, startLineOption, followOption],
  api: { path: '/thread/[threadId]/logs', method: 'GET', streaming: true, cwdParam: 'threadId' },
  run: lazyRun('threadLogsCommand'),
};

const updateCommandDef: CliCommandDef = {
  name: 'update',
  description: 'Apply parent/prod updates to the current thread.',
  options: [jsonOption, userOption],
  api: { path: '/thread/[threadId]/update', cwdParam: 'threadId' },
  run: lazyRun('threadUpdateCommand'),
};

const acceptCommandDef: CliCommandDef = {
  name: 'accept',
  description: 'Accept (deploy/merge) the current thread.',
  options: [jsonOption, userOption],
  api: { path: '/thread/[threadId]/accept', cwdParam: 'threadId' },
  run: lazyRun('threadAcceptCommand'),
};

const rejectCommandDef: CliCommandDef = {
  name: 'reject',
  description: 'Reject (discard) the current thread.',
  options: [jsonOption, userOption],
  api: { path: '/thread/[threadId]/reject', cwdParam: 'threadId' },
  run: lazyRun('threadRejectCommand'),
};

const jobsRunCommandDef: CliCommandDef = {
  name: 'run',
  description: 'Run the Primordia scheduled jobs daemon in this process.',
  options: [jsonOption],
  api: { path: '/jobs/run', streaming: true },
  run: lazyRun('jobsRunCommand'),
};

const jobsRunOneCommandDef: CliCommandDef = {
  name: 'run-one',
  description: 'Run one Primordia scheduled job immediately.',
  options: [jsonOption],
  arguments: [jobNameArgument],
  api: { path: '/jobs/run-one' },
  run: lazyRun('jobsRunOneCommand'),
};

const jobsScheduleListCommandDef: CliCommandDef = {
  name: 'list',
  description: 'List scheduled job intervals.',
  options: [jsonOption],
  api: { path: '/jobs/schedule', method: 'GET' },
  run: lazyRun('jobsScheduleListCommand'),
};

const jobsScheduleGetCommandDef: CliCommandDef = {
  name: 'get',
  description: 'Read one scheduled job interval.',
  options: [jsonOption],
  arguments: [jobNameArgument],
  api: { path: '/jobs/schedule/[job]', method: 'GET' },
  run: lazyRun('jobsScheduleGetCommand'),
};

const jobsScheduleSetCommandDef: CliCommandDef = {
  name: 'set',
  description: 'Set one scheduled job interval.',
  options: [jsonOption],
  arguments: [jobNameArgument, intervalArgument],
  api: { path: '/jobs/schedule/[job]/set' },
  run: lazyRun('jobsScheduleSetCommand'),
};

const jobsScheduleCommandDef: CliCommandDef = {
  name: 'schedule',
  description: 'Read or change scheduled job intervals.',
  subcommands: [jobsScheduleListCommandDef, jobsScheduleGetCommandDef, jobsScheduleSetCommandDef],
};

const jobsRestartCommandDef: CliCommandDef = {
  name: 'restart',
  description: 'Restart the supervised scheduled jobs daemon.',
  options: [jsonOption],
  api: { path: '/jobs/restart' },
  run: lazyRun('jobsRestartCommand'),
};

const jobsLogsCommandDef: CliCommandDef = {
  name: 'logs',
  description: 'Print the supervised scheduled jobs daemon log.',
  options: [jsonOption, linesOption, startLineOption, followOption],
  api: { path: '/jobs/logs', method: 'GET', streaming: true },
  run: lazyRun('jobsLogsCommand'),
};

const jobsCommandDef: CliCommandDef = {
  name: 'jobs',
  description: 'Run and configure Primordia Core scheduled jobs.',
  subcommands: [jobsRunCommandDef, jobsRunOneCommandDef, jobsRestartCommandDef, jobsLogsCommandDef, jobsScheduleCommandDef],
};

const reverseProxyRestartCommandDef: CliCommandDef = {
  name: 'restart',
  description: 'Restart the supervised reverse proxy service.',
  options: [jsonOption],
  api: { path: '/reverse-proxy/restart' },
  run: lazyRun('reverseProxyRestartCommand'),
};

const reverseProxyLogsCommandDef: CliCommandDef = {
  name: 'logs',
  description: 'Print the supervised reverse proxy service log.',
  options: [jsonOption, linesOption, startLineOption, followOption],
  api: { path: '/reverse-proxy/logs', method: 'GET', streaming: true },
  run: lazyRun('reverseProxyLogsCommand'),
};

const reverseProxyCommandDef: CliCommandDef = {
  name: 'reverse-proxy',
  description: 'Manage the supervised reverse proxy service.',
  subcommands: [reverseProxyRestartCommandDef, reverseProxyLogsCommandDef],
};

const serviceSupervisorRestartCommandDef: CliCommandDef = {
  name: 'restart',
  description: 'Restart only the Primordia service-supervisor systemd service.',
  options: [jsonOption],
  api: { path: '/systemd/service-supervisor/restart' },
  run: lazyRun('systemdServiceSupervisorRestartCommand'),
};

const serviceSupervisorCommandDef: CliCommandDef = {
  name: 'service-supervisor',
  description: 'Manage the systemd-supervised Primordia service supervisor.',
  subcommands: [serviceSupervisorRestartCommandDef],
};

const systemdCommandDef: CliCommandDef = {
  name: 'systemd',
  description: 'Manage Primordia systemd-backed processes.',
  subcommands: [serviceSupervisorCommandDef],
};

const preferencesGetCommandDef: CliCommandDef = {
  name: 'get',
  description: 'Show saved user preferences used by thread creation.',
  options: [jsonOption, userOption],
  api: { path: '/preferences', method: 'GET' },
  run: lazyRun('preferencesGetCommand'),
};

const preferencesSetCommandDef: CliCommandDef = {
  name: 'set',
  description: 'Set saved user preferences used by thread creation.',
  options: [jsonOption, userOption, presetOption, harnessOption, modelOption, cavemanOption, cavemanIntensityOption],
  api: { path: '/preferences/set' },
  run: lazyRun('preferencesSetCommand'),
};

const preferencesCommandDef: CliCommandDef = {
  name: 'preferences',
  description: 'Read and set per-user thread preferences.',
  subcommands: [preferencesGetCommandDef, preferencesSetCommandDef],
};

const threadCommandDef: CliCommandDef = {
  name: 'thread',
  description: 'Manage Primordia agentic coding threads.',
  subcommands: [createCommandDef, followupCommandDef, threadLogsCommandDef, updateCommandDef, acceptCommandDef, rejectCommandDef],
};

const serverCommandDef: CliCommandDef = {
  name: 'server',
  description: 'Manage the current thread server process.',
  subcommands: [serverStatusCommandDef, startCommandDef, stopCommandDef, restartCommandDef, logsCommandDef, publishCommandDef, copyDbCommandDef],
};


export const mainCommand: CliCommandDef = {
  name: 'primordia',
  description: 'Manage Primordia thread and server lifecycle tasks.',
  subcommands: [statusCommandDef, threadCommandDef, preferencesCommandDef, serverCommandDef, jobsCommandDef, reverseProxyCommandDef, systemdCommandDef],
};
