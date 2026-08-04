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
import { resolveCliPresetIdForUser } from './primordia-preset-helpers';
import { createDefaultCliContext, type PrimordiaCliContext } from './primordia-cli-context';
import type { SessionEvent } from '@/lib/session-events';
import type { CliParsedArgs } from '@/lib/tiny-cli';

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

async function writeStream(stream: PrimordiaCliContext['stdout'] | PrimordiaCliContext['stderr'], chunk: string): Promise<void> {
  if (!stream.write(chunk)) await new Promise((resolve) => stream.once('drain', resolve));
}

function writeLine(ctx: PrimordiaCliContext, text: string): void {
  ctx.stdout.write(`${text}\n`);
}

function writeErrorLine(ctx: PrimordiaCliContext, text: string): void {
  ctx.stderr.write(`${text}\n`);
}

const MISSING_CLI_KEY_MESSAGE =
  'PRIMORDIA_CLI_KEY is required for `primordia thread create`, `primordia thread followup`, and `primordia thread accept`. ' +
  'Open Settings → API keys in the web app (/settings/api-keys), create a CLI key, copy the one-time `PRIMORDIA_CLI_KEY=...` value, and export it in this shell before retrying.';

function printJson(ctx: PrimordiaCliContext, value: unknown): void {
  writeLine(ctx, JSON.stringify(value, null, 2));
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

function resolveCurrentThread(report: ProcessStatusReport, cwd: string): { threadId: string; path: string } {
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

function resolveCurrentThreadId(ctx: PrimordiaCliContext): string {
  return resolveCurrentThread(getProcessStatusReport(ctx.cwd()), ctx.cwd()).threadId;
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

async function* followTextLogLines(logFile: string, pollMs = 500): AsyncGenerator<string> {
  let offset = 0;
  try { offset = fs.statSync(logFile).size; } catch { offset = 0; }
  let buffered = '';
  while (true) {
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

async function renderLogFile(ctx: PrimordiaCliContext, logFile: string, args: ServiceLogArgs, options: { rawNdjson?: boolean; humanFormatter?: (line: string) => HumanLogChunk | null; humanRenderer?: HumanLogRenderer } = {}): Promise<void> {
  const startLine = resolveLogStartLine(args);
  const lineCount = resolveLogLineCount(args, startLine);
  const follow = Boolean(args.follow || args.f);
  const allLines = readTextLogLines(logFile);
  const selectedLines = selectLogLines(allLines, lineCount, startLine);

  if (args.json) {
    for (const line of selectedLines) ctx.stdout.write(formatNdjsonLine(line, Boolean(options.rawNdjson)));
    if (follow) {
      for await (const line of followTextLogLines(logFile)) ctx.stdout.write(formatNdjsonLine(line, Boolean(options.rawNdjson)));
    }
    return;
  }

  const renderer = options.humanRenderer;
  const formatter = renderer ? renderer.format : (options.humanFormatter ?? ((line: string) => line));
  let inlineOpen = false;
  const writeFormatted = (formatted: HumanLogChunk | null): void => {
    if (!formatted) return;
    if (typeof formatted === 'object' && formatted.inline) {
      ctx.stdout.write(formatted.text);
      inlineOpen = true;
      return;
    }
    if (inlineOpen) ctx.stdout.write('\n');
    const text = typeof formatted === 'string' ? formatted : formatted.text;
    writeLine(ctx, text);
    inlineOpen = false;
  };

  for (const line of selectedLines) writeFormatted(formatter(line));
  if (follow) {
    for await (const line of followTextLogLines(logFile)) writeFormatted(formatter(line));
  }
  if (renderer) writeFormatted(renderer.flush());
  if (inlineOpen) ctx.stdout.write('\n');
}

async function renderServerLogs(ctx: PrimordiaCliContext, threadId: string, args: ServiceLogArgs): Promise<void> {
  await renderLogFile(ctx, getWorktreeServerLogPath(ctx, threadId), args);
}

function getWorktreeServerLogPath(ctx: PrimordiaCliContext, threadId: string): string {
  const report = getProcessStatusReport(ctx.cwd());
  const worktree = report.worktrees.find((entry) => entry.branch === threadId);
  if (!worktree) throw new Error(`Unknown thread/worktree: ${threadId}`);
  return path.join(worktree.path, '.primordia-next-server.log');
}

async function readRequest(ctx: PrimordiaCliContext, args: CliParsedArgs): Promise<string> {
  const parts = args._.length > 0 ? args._ : typeof args.request === 'string' ? [args.request] : [];
  if (parts.length === 0) throw new Error('request text required');
  if (parts.length === 1 && parts[0] === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of ctx.stdin) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) throw new Error('stdin request text is empty');
    return text;
  }
  return parts.join(' ').trim();
}

async function resolveCliAuth(ctx: PrimordiaCliContext, selector: string | undefined): Promise<{ user: { id: string; username: string }; primordiaAesKey: string }> {
  const coreUserId = ctx.env.PRIMORDIA_CORE_USER_ID;
  const coreAesKey = ctx.env.PRIMORDIA_CORE_AES_KEY ?? '';
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

  const rawCliKey = ctx.env.PRIMORDIA_CLI_KEY;
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

function getCurrentThread(ctx: PrimordiaCliContext): { threadId: string; path: string } {
  return resolveCurrentThread(getProcessStatusReport(ctx.cwd()), ctx.cwd());
}

function resolveJobName(args: CliParsedArgs): PrimordiaJobName {
  const value = String(args._[0] ?? args.job ?? '');
  if (!isPrimordiaJobName(value)) throw new Error(`Unknown Primordia job: ${value || '(missing)'}`);
  return value;
}

function scheduleRows(ctx: PrimordiaCliContext, repoRoot = ctx.cwd()) {
  return listJobSchedules(repoRoot).map((schedule) => ({
    name: schedule.name,
    intervalMs: schedule.intervalMs,
    interval: formatJobInterval(schedule.intervalMs),
    defaultIntervalMs: schedule.defaultIntervalMs,
    defaultInterval: formatJobInterval(schedule.defaultIntervalMs),
    gitConfigKey: schedule.gitConfigKey,
  }));
}

function printScheduleTable(ctx: PrimordiaCliContext, rows: ReturnType<typeof scheduleRows>): void {
  const nameWidth = Math.max('job'.length, ...rows.map((row) => row.name.length));
  const intervalWidth = Math.max('interval'.length, ...rows.map((row) => row.interval.length));
  writeLine(ctx, `${'job'.padEnd(nameWidth)}  ${'interval'.padEnd(intervalWidth)}  git config`);
  for (const row of rows) writeLine(ctx, `${row.name.padEnd(nameWidth)}  ${row.interval.padEnd(intervalWidth)}  ${row.gitConfigKey}`);
}

function serviceSignal(service: SupervisedServiceName): NodeJS.Signals {
  return service === 'reverse-proxy' ? 'SIGUSR1' : 'SIGUSR2';
}

function signalSupervisorViaSystemd(ctx: PrimordiaCliContext, signal: NodeJS.Signals): boolean {
  const unit = ctx.env.PRIMORDIA_SERVICE_UNIT || 'primordia';
  try {
    execFileSync('systemctl', ['is-active', '--quiet', unit], { stdio: 'ignore' });
    execFileSync('systemctl', ['kill', '--kill-whom=main', `--signal=${signal}`, unit], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function signalSupervisorViaPgrep(signal: NodeJS.Signals): number[] {
  let output = '';
  try {
    output = execFileSync('pgrep', ['-f', 'service-supervisor\\.(js|ts)'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return [];
  }
  const pids = output
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  for (const pid of pids) process.kill(pid, signal);
  return pids;
}

function restartServiceSupervisor(ctx: PrimordiaCliContext, json: boolean | undefined): void {
  const unit = ctx.env.PRIMORDIA_SERVICE_UNIT || 'primordia';
  try {
    execFileSync('systemctl', ['restart', unit], { stdio: 'ignore' });
  } catch {
    throw new Error(`Could not restart ${unit}; service-supervisor restart requires systemd access`);
  }
  const result = { ok: true, service: 'service-supervisor', action: 'restart', via: 'systemd' };
  if (json) printJson(ctx, result);
  else writeLine(ctx, 'Restarted service-supervisor via systemd.');
}

function restartSupervisedService(ctx: PrimordiaCliContext, service: SupervisedServiceName, json: boolean | undefined): void {
  const signal = serviceSignal(service);
  const viaSystemd = signalSupervisorViaSystemd(ctx, signal);
  const pids = viaSystemd ? [] : signalSupervisorViaPgrep(signal);
  if (!viaSystemd && pids.length === 0) throw new Error('Primordia service-supervisor is not running or could not be signaled');
  const result = { ok: true, service, action: 'restart', signal, via: viaSystemd ? 'systemd' : 'process', pids };
  if (json) printJson(ctx, result);
  else writeLine(ctx, `Signaled ${service} restart via ${result.via} (${signal}).`);
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

export function statusCommand(args: CliParsedArgs & JsonArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): void {
  const report = getProcessStatusReport(ctx.cwd());
  if (args.json) printJson(ctx, report);
  else writeLine(ctx, formatProcessStatusReport(report));
}

export async function jobsRunCommand(args: CliParsedArgs & JsonArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const listenPort = Number.parseInt(ctx.env.REVERSE_PROXY_PORT ?? '', 10);
  const started = runPrimordiaJobs({
    repoRoot: ctx.cwd(),
    listenPort: Number.isFinite(listenPort) ? listenPort : undefined,
    archiveRoot: ctx.env.PRIMORDIA_DIR,
  });
  if (args.json) printJson(ctx, { ok: started, command: 'jobs run', schedules: scheduleRows(ctx) });
  else writeLine(ctx, started ? 'Primordia jobs daemon running. Press Ctrl-C to stop.' : 'Another Primordia jobs scheduler is already running.');
  if (!started) return;
  await new Promise(() => { /* keep daemon alive */ });
}

export async function jobsRunOneCommand(args: CliParsedArgs & JsonArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const job = resolveJobName(args);
  const result = await runPrimordiaJobOnce(job, { repoRoot: ctx.cwd() });
  if (args.json) printJson(ctx, result);
  else writeLine(ctx, `${result.ok ? 'ok' : 'failed'}: ${result.summary}`);
  if (!result.ok) ctx.exit(1);
}

function serviceLogFile(ctx: PrimordiaCliContext, service: SupervisedServiceName): string {
  const root = ctx.env.PRIMORDIA_DIR || ctx.cwd();
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

async function renderServiceLog(ctx: PrimordiaCliContext, service: SupervisedServiceName, args: ServiceLogArgs): Promise<void> {
  await renderLogFile(ctx, serviceLogFile(ctx, service), args);
}

export function systemdServiceSupervisorRestartCommand(args: CliParsedArgs & JsonArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): void {
  restartServiceSupervisor(ctx, args.json);
}

export function reverseProxyRestartCommand(args: CliParsedArgs & JsonArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): void {
  restartSupervisedService(ctx, 'reverse-proxy', args.json);
}

export async function reverseProxyLogsCommand(args: CliParsedArgs & ServiceLogArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  await renderServiceLog(ctx, 'reverse-proxy', args);
}

export function jobsRestartCommand(args: CliParsedArgs & JsonArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): void {
  restartSupervisedService(ctx, 'scheduled-jobs', args.json);
}

export async function jobsLogsCommand(args: CliParsedArgs & ServiceLogArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  await renderServiceLog(ctx, 'scheduled-jobs', args);
}

export function jobsScheduleListCommand(args: CliParsedArgs & JsonArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): void {
  const rows = scheduleRows(ctx);
  if (args.json) printJson(ctx, { schedules: rows });
  else printScheduleTable(ctx, rows);
}

export function jobsScheduleGetCommand(args: CliParsedArgs & JsonArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): void {
  const job = resolveJobName(args);
  const row = scheduleRows(ctx).find((schedule) => schedule.name === job)!;
  if (args.json) printJson(ctx, row);
  else writeLine(ctx, `${row.name}: ${row.interval} (${row.intervalMs}ms)`);
}

export function jobsScheduleSetCommand(args: CliParsedArgs & JsonArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): void {
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
  if (args.json) printJson(ctx, row);
  else writeLine(ctx, `${row.name}: ${row.interval} (${row.gitConfigKey})`);
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

export async function preferencesGetCommand(args: CliParsedArgs & JsonArgs & UserSelectorArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
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
  if (args.json) printJson(ctx, result);
  else {
    writeLine(ctx, `User: ${user.username} (${user.id})`);
    writeLine(ctx, `preferred preset: ${result.preferences.preferredPreset ?? '(not set)'}`);
    writeLine(ctx, `fallback harness: ${result.effectiveThreadFormDefaults.initialHarness}`);
    writeLine(ctx, `fallback model: ${result.effectiveThreadFormDefaults.initialModel}`);
    writeLine(ctx, `caveman mode: ${result.effectiveThreadFormDefaults.initialCavemanMode}`);
    writeLine(ctx, `caveman intensity: ${result.effectiveThreadFormDefaults.initialCavemanIntensity}`);
  }
}

export async function preferencesSetCommand(args: CliParsedArgs & JsonArgs & UserSelectorArgs & PreferenceSetArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
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
  if (args.json) printJson(ctx, result);
  else {
    writeLine(ctx, `Updated preferences for ${user.username}.`);
    for (const [key, value] of Object.entries(updates)) writeLine(ctx, `${key}: ${value}`);
  }
}

function getServerStatus(ctx: PrimordiaCliContext, threadId: string): { threadId: string; status: 'running' | 'stopped' | 'unknown' } {
  const worktree = getProcessStatusReport(ctx.cwd()).worktrees.find((entry) => entry.branch === threadId);
  return {
    threadId,
    status: !worktree ? 'unknown' : worktree.servers.length > 0 ? 'running' : 'stopped',
  };
}

function formatServerStatus(snapshot: ReturnType<typeof getServerStatus>, json: boolean): string {
  return json ? JSON.stringify(snapshot) : `${snapshot.threadId}: ${snapshot.status}`;
}

export async function serverStatusCommand(args: CliParsedArgs & ServerStatusArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const thread = getCurrentThread(ctx);
  let previous = '';
  do {
    const snapshot = getServerStatus(ctx, thread.threadId);
    const serialized = JSON.stringify(snapshot);
    if (serialized !== previous) {
      writeLine(ctx, formatServerStatus(snapshot, Boolean(args.json)));
      previous = serialized;
    }
    if (!(args.follow || args.f)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (true);
}

export async function serverStartCommand(args: CliParsedArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const thread = getCurrentThread(ctx);
  const result = await startWorktreeServer(thread.threadId, resolveStartMode(args), ctx.cwd());
  if (args.json) printJson(ctx, result);
  else writeLine(ctx, result.message);
}

export async function serverStopCommand(args: CliParsedArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const thread = getCurrentThread(ctx);
  const result = await stopWorktreeServer(thread.threadId, ctx.cwd());
  if (args.json) printJson(ctx, result);
  else writeLine(ctx, result.message);
}

export async function serverRestartCommand(args: CliParsedArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const thread = getCurrentThread(ctx);
  const result = await restartWorktreeServer(thread.threadId, resolveStartMode(args), ctx.cwd());
  if (args.json) printJson(ctx, result);
  else writeLine(ctx, result.message);
}

export async function serverLogsCommand(args: CliParsedArgs & ServiceLogArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const thread = getCurrentThread(ctx);
  await renderServerLogs(ctx, thread.threadId, args);
}

export async function threadLogsCommand(args: CliParsedArgs & ServiceLogArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const thread = getCurrentThread(ctx);
  await renderLogFile(ctx, path.join(thread.path, '.primordia-session.ndjson'), args, {
    rawNdjson: true,
    humanRenderer: createSessionHumanRenderer(),
  });
}

export async function serverPublishCommand(args: CliParsedArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const thread = getCurrentThread(ctx);
  const result = await publishProductionBranch(thread.threadId, ctx.cwd());
  if (args.json) printJson(ctx, result);
  else writeLine(ctx, result.message);
}

export async function serverCopyDbCommand(args: CliParsedArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const thread = getCurrentThread(ctx);
  const result = await copyProductionDbToWorktree(ctx.cwd(), thread.path);
  if (args.json) {
    printJson(ctx, result);
  } else if (result.copied) {
    writeLine(ctx, `Copied production DB from ${result.sourcePath} to ${result.destinationPath}`);
  } else {
    writeErrorLine(ctx, `Failed to copy production DB to ${result.destinationPath}: ${result.error ?? 'unknown error'}`);
  }
  if (!result.copied) ctx.exit(1);
}

export async function threadCreateCommand(args: CliParsedArgs & JsonArgs & PresetArgs & CavemanArgs & UserSelectorArgs & AttachArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const requestText = await readRequest(ctx, args);
  const { user, primordiaAesKey } = await resolveCliAuth(ctx, args.user);
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
  if (args.json) printJson(ctx, { ok: true, command: 'thread create', threadId: result.sessionId, worktreePath: result.worktreePath, background: true });
  else writeLine(ctx, `New thread started in ${result.worktreePath}`);
}

export async function threadFollowupCommand(args: CliParsedArgs & JsonArgs & PresetArgs & UserSelectorArgs & AttachArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  const requestText = await readRequest(ctx, args);
  const { user, primordiaAesKey } = await resolveCliAuth(ctx, args.user);
  const threadId = resolveCurrentThreadId(ctx);
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
  if (args.json) printJson(ctx, { ok: true, command: 'thread followup', thread: threadId, background: true });
  else writeLine(ctx, `Follow-up started for ${threadId}.`);
}

export async function threadUpdateCommand(args: CliParsedArgs & JsonArgs & UserSelectorArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  rejectUnexpectedRequestText(args, 'update');
  const user = await resolveCliUser(args.user);
  const threadId = resolveCurrentThreadId(ctx);
  const result = await updateThread({ userId: user.id, threadId });
  if (!result.ok) throw new Error(result.error);
  if (args.json) printJson(ctx, { ok: true, command: 'thread update', thread: threadId, outcome: result.outcome, log: result.log });
  else {
    writeLine(ctx, `Updated ${threadId}: ${result.outcome}.`);
    if (result.log.trim()) writeLine(ctx, result.log.trim());
  }
}

async function handleDecision(ctx: PrimordiaCliContext, args: CliParsedArgs & JsonArgs & UserSelectorArgs, action: 'accept' | 'reject'): Promise<void> {
  rejectUnexpectedRequestText(args, action);
  const auth = action === 'accept'
    ? await resolveCliAuth(ctx, args.user)
    : { user: await resolveCliUser(args.user), primordiaAesKey: null };
  const threadId = resolveCurrentThreadId(ctx);
  const result = await manageThread({
    userId: auth.user.id,
    threadId,
    action,
    primordiaAesKey: auth.primordiaAesKey,
  });
  if (!result.ok) throw cliSecretError(result.error, 'thread decision failed');
  if (args.json) printJson(ctx, { ok: true, command: `thread ${action}`, thread: threadId, outcome: result.outcome });
  else writeLine(ctx, `${action === 'accept' ? 'Accept' : 'Reject'} started for ${threadId}: ${result.outcome}.`);
}

export function threadAcceptCommand(args: CliParsedArgs & JsonArgs & UserSelectorArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  return handleDecision(ctx, args, 'accept');
}

export function threadRejectCommand(args: CliParsedArgs & JsonArgs & UserSelectorArgs, ctx: PrimordiaCliContext = createDefaultCliContext()): Promise<void> {
  return handleDecision(ctx, args, 'reject');
}
