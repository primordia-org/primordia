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
import { BUILT_IN_PRESETS, PREF_CUSTOM_PRESETS, PREF_PRESET, parseCustomPresets } from '@/lib/presets';
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
import type { SessionEvent } from '@/lib/session-events';
import type { CliParsedArgs } from '@/lib/tiny-cli';

type UserSelectorArgs = { user?: string };
type JsonArgs = { json?: boolean };
type ModeArgs = { dev?: boolean; prod?: boolean };
type PresetArgs = { preset?: string };
type AttachArgs = { attach?: string | string[]; a?: string | string[] };
type PreferenceSetArgs = PresetArgs & {
  harness?: string;
  model?: string;
  caveman?: string;
  'caveman-intensity'?: string;
};
type PrimordiaServiceName = 'service-supervisor' | 'reverse-proxy' | 'scheduled-jobs';
type SupervisedServiceName = Exclude<PrimordiaServiceName, 'service-supervisor'>;
type ServiceLogArgs = JsonArgs & { lines?: string; n?: string; follow?: boolean; f?: boolean };

const MISSING_CLI_KEY_MESSAGE =
  'PRIMORDIA_CLI_KEY is required for `primordia thread create`, `primordia thread followup`, and `primordia thread accept`. ' +
  'Open Settings → API keys in the web app (/settings/api-keys), create a CLI key, copy the one-time `PRIMORDIA_CLI_KEY=...` value, and export it in this shell before retrying.';

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
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

function resolveCurrentThread(report: ProcessStatusReport, cwd = process.cwd()): { threadId: string; path: string } {
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

function resolveCurrentThreadId(): string {
  return resolveCurrentThread(getProcessStatusReport()).threadId;
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

function formatToolInput(input: Record<string, unknown>): string {
  const command = input.command;
  if (typeof command === 'string') return command;
  const keys = Object.keys(input);
  return keys.length > 0 ? keys.join(', ') : 'no input';
}

type HumanLogChunk = string | { text: string; inline?: boolean };

function formatSessionEventHuman(line: string): HumanLogChunk | null {
  const event = parseSessionEventLine(line);
  if (event.type === 'malformed_log_line') return event.line;

  switch (event.type) {
    case 'section_start':
      return `\n${event.label}`;
    case 'setup_step':
      return event.done ? `✓ ${event.label}` : `• ${event.label}`;
    case 'initial_request':
      return `User asked: ${compactText(event.request)}`;
    case 'followup_request':
      return `Follow-up: ${compactText(event.request)}`;
    case 'text':
    case 'thinking':
    case 'log_line': {
      const text = compactText(event.content);
      return text ? { text, inline: true } : null;
    }
    case 'tool_use':
      return `Ran ${event.name}: ${formatToolInput(event.input)}`;
    case 'result':
      return `${event.subtype === 'success' ? '✓' : '✗'} ${event.message ? compactText(event.message) : event.subtype}`;
    case 'metrics': {
      const parts = [
        event.durationMs === null ? null : `${Math.round(event.durationMs / 1000)}s`,
        event.inputTokens === null ? null : `${event.inputTokens} input tokens`,
        event.outputTokens === null ? null : `${event.outputTokens} output tokens`,
        event.costUsd === null ? null : `$${event.costUsd.toFixed(4)}`,
      ].filter(Boolean);
      return parts.length > 0 ? `Metrics: ${parts.join(', ')}` : null;
    }
    case 'progress_plan':
      return event.steps.length > 0 ? `Plan: ${event.steps.map((step) => step.label).join(' → ')}` : null;
    case 'progress_step':
      return event.status === 'done'
        ? `Completed step${event.activatedNextLabel ? `; next: ${event.activatedNextLabel}` : ''}`
        : `Step failed${event.activatedNextLabel ? `; next: ${event.activatedNextLabel}` : ''}`;
    case 'preview_path':
      return `Preview: ${event.path}`;
    case 'decision':
      return `${event.action === 'accepted' ? 'Accepted' : 'Rejected'}: ${event.detail}`;
    default:
      return null;
  }
}

async function renderLogFile(logFile: string, args: ServiceLogArgs, options: { rawNdjson?: boolean; humanFormatter?: (line: string) => HumanLogChunk | null } = {}): Promise<void> {
  const lineCount = resolveLogLineCount(args);
  const follow = Boolean(args.follow || args.f);
  const recent = lineCount === 0 ? [] : readTextLogLines(logFile).slice(-lineCount);

  if (args.json) {
    for (const line of recent) process.stdout.write(formatNdjsonLine(line, Boolean(options.rawNdjson)));
    if (follow) {
      for await (const line of followTextLogLines(logFile)) process.stdout.write(formatNdjsonLine(line, Boolean(options.rawNdjson)));
    }
    return;
  }

  const formatter = options.humanFormatter ?? ((line: string) => line);
  let inlineOpen = false;
  const writeFormatted = (formatted: HumanLogChunk | null): void => {
    if (!formatted) return;
    if (typeof formatted === 'object' && formatted.inline) {
      process.stdout.write(`${inlineOpen ? ' ' : ''}${formatted.text}`);
      inlineOpen = true;
      return;
    }
    if (inlineOpen) process.stdout.write('\n');
    const text = typeof formatted === 'string' ? formatted : formatted.text;
    console.log(text);
    inlineOpen = false;
  };

  for (const line of recent) writeFormatted(formatter(line));
  if (follow) {
    for await (const line of followTextLogLines(logFile)) writeFormatted(formatter(line));
  }
  if (inlineOpen) process.stdout.write('\n');
}

async function renderServerLogs(threadId: string, args: ServiceLogArgs): Promise<void> {
  await renderLogFile(getWorktreeServerLogPath(threadId), args);
}

function getWorktreeServerLogPath(threadId: string): string {
  const report = getProcessStatusReport();
  const worktree = report.worktrees.find((entry) => entry.branch === threadId);
  if (!worktree) throw new Error(`Unknown thread/worktree: ${threadId}`);
  return path.join(worktree.path, '.primordia-next-server.log');
}

async function readRequest(args: CliParsedArgs): Promise<string> {
  const parts = args._.length > 0 ? args._ : typeof args.request === 'string' ? [args.request] : [];
  if (parts.length === 0) throw new Error('request text required');
  if (parts.length === 1 && parts[0] === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) throw new Error('stdin request text is empty');
    return text;
  }
  return parts.join(' ').trim();
}

async function resolveCliAuth(selector: string | undefined): Promise<{ user: { id: string; username: string }; primordiaAesKey: string }> {
  const coreUserId = process.env.PRIMORDIA_CORE_USER_ID;
  const coreAesKey = process.env.PRIMORDIA_CORE_AES_KEY;
  if (coreUserId && coreAesKey) {
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

  const rawCliKey = process.env.PRIMORDIA_CLI_KEY;
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

function getCurrentThread(): { threadId: string; path: string } {
  return resolveCurrentThread(getProcessStatusReport());
}

function resolveJobName(args: CliParsedArgs): PrimordiaJobName {
  const value = String(args._[0] ?? args.job ?? '');
  if (!isPrimordiaJobName(value)) throw new Error(`Unknown Primordia job: ${value || '(missing)'}`);
  return value;
}

function scheduleRows(repoRoot = process.cwd()) {
  return listJobSchedules(repoRoot).map((schedule) => ({
    name: schedule.name,
    intervalMs: schedule.intervalMs,
    interval: formatJobInterval(schedule.intervalMs),
    defaultIntervalMs: schedule.defaultIntervalMs,
    defaultInterval: formatJobInterval(schedule.defaultIntervalMs),
    gitConfigKey: schedule.gitConfigKey,
  }));
}

function printScheduleTable(rows: ReturnType<typeof scheduleRows>): void {
  const nameWidth = Math.max('job'.length, ...rows.map((row) => row.name.length));
  const intervalWidth = Math.max('interval'.length, ...rows.map((row) => row.interval.length));
  console.log(`${'job'.padEnd(nameWidth)}  ${'interval'.padEnd(intervalWidth)}  git config`);
  for (const row of rows) console.log(`${row.name.padEnd(nameWidth)}  ${row.interval.padEnd(intervalWidth)}  ${row.gitConfigKey}`);
}

function serviceSignal(service: SupervisedServiceName): NodeJS.Signals {
  return service === 'reverse-proxy' ? 'SIGUSR1' : 'SIGUSR2';
}

function signalSupervisorViaSystemd(signal: NodeJS.Signals): boolean {
  const unit = process.env.PRIMORDIA_SERVICE_UNIT || 'primordia';
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

function restartServiceSupervisor(json: boolean | undefined): void {
  const unit = process.env.PRIMORDIA_SERVICE_UNIT || 'primordia';
  try {
    execFileSync('systemctl', ['restart', unit], { stdio: 'ignore' });
  } catch {
    throw new Error(`Could not restart ${unit}; service-supervisor restart requires systemd access`);
  }
  const result = { ok: true, service: 'service-supervisor', action: 'restart', via: 'systemd' };
  if (json) printJson(result);
  else console.log('Restarted service-supervisor via systemd.');
}

function restartSupervisedService(service: SupervisedServiceName, json: boolean | undefined): void {
  const signal = serviceSignal(service);
  const viaSystemd = signalSupervisorViaSystemd(signal);
  const pids = viaSystemd ? [] : signalSupervisorViaPgrep(signal);
  if (!viaSystemd && pids.length === 0) throw new Error('Primordia service-supervisor is not running or could not be signaled');
  const result = { ok: true, service, action: 'restart', signal, via: viaSystemd ? 'systemd' : 'process', pids };
  if (json) printJson(result);
  else console.log(`Signaled ${service} restart via ${result.via} (${signal}).`);
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

export function statusCommand(args: CliParsedArgs & JsonArgs): void {
  const report = getProcessStatusReport();
  if (args.json) printJson(report);
  else console.log(formatProcessStatusReport(report));
}

export async function jobsRunCommand(args: CliParsedArgs & JsonArgs): Promise<void> {
  const listenPort = Number.parseInt(process.env.REVERSE_PROXY_PORT ?? '', 10);
  const started = runPrimordiaJobs({
    repoRoot: process.cwd(),
    listenPort: Number.isFinite(listenPort) ? listenPort : undefined,
    archiveRoot: process.env.PRIMORDIA_DIR,
  });
  if (args.json) printJson({ ok: started, command: 'jobs run', schedules: scheduleRows() });
  else console.log(started ? 'Primordia jobs daemon running. Press Ctrl-C to stop.' : 'Another Primordia jobs scheduler is already running.');
  if (!started) return;
  await new Promise(() => { /* keep daemon alive */ });
}

export async function jobsRunOneCommand(args: CliParsedArgs & JsonArgs): Promise<void> {
  const job = resolveJobName(args);
  const result = await runPrimordiaJobOnce(job, { repoRoot: process.cwd() });
  if (args.json) printJson(result);
  else console.log(`${result.ok ? 'ok' : 'failed'}: ${result.summary}`);
  if (!result.ok) process.exit(1);
}

function serviceLogFile(service: SupervisedServiceName): string {
  const root = process.env.PRIMORDIA_DIR || process.cwd();
  return path.join(root, service === 'reverse-proxy' ? '.primordia-reverse-proxy.log' : '.primordia-scheduled-jobs.log');
}

function resolveLogLineCount(args: ServiceLogArgs): number {
  const raw = args.lines ?? args.n ?? '100';
  const count = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(count) || count < 0) throw new Error('--lines/-n must be a non-negative integer');
  return count;
}

async function renderServiceLog(service: SupervisedServiceName, args: ServiceLogArgs): Promise<void> {
  await renderLogFile(serviceLogFile(service), args);
}

export function systemdServiceSupervisorRestartCommand(args: CliParsedArgs & JsonArgs): void {
  restartServiceSupervisor(args.json);
}

export function reverseProxyRestartCommand(args: CliParsedArgs & JsonArgs): void {
  restartSupervisedService('reverse-proxy', args.json);
}

export async function reverseProxyLogsCommand(args: CliParsedArgs & ServiceLogArgs): Promise<void> {
  await renderServiceLog('reverse-proxy', args);
}

export function jobsRestartCommand(args: CliParsedArgs & JsonArgs): void {
  restartSupervisedService('scheduled-jobs', args.json);
}

export async function jobsLogsCommand(args: CliParsedArgs & ServiceLogArgs): Promise<void> {
  await renderServiceLog('scheduled-jobs', args);
}

export function jobsScheduleListCommand(args: CliParsedArgs & JsonArgs): void {
  const rows = scheduleRows();
  if (args.json) printJson({ schedules: rows });
  else printScheduleTable(rows);
}

export function jobsScheduleGetCommand(args: CliParsedArgs & JsonArgs): void {
  const job = resolveJobName(args);
  const row = scheduleRows().find((schedule) => schedule.name === job)!;
  if (args.json) printJson(row);
  else console.log(`${row.name}: ${row.interval} (${row.intervalMs}ms)`);
}

export function jobsScheduleSetCommand(args: CliParsedArgs & JsonArgs): void {
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
  if (args.json) printJson(row);
  else console.log(`${row.name}: ${row.interval} (${row.gitConfigKey})`);
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

export async function preferencesGetCommand(args: CliParsedArgs & JsonArgs & UserSelectorArgs): Promise<void> {
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
  if (args.json) printJson(result);
  else {
    console.log(`User: ${user.username} (${user.id})`);
    console.log(`preferred preset: ${result.preferences.preferredPreset ?? '(not set)'}`);
    console.log(`fallback harness: ${result.effectiveThreadFormDefaults.initialHarness}`);
    console.log(`fallback model: ${result.effectiveThreadFormDefaults.initialModel}`);
    console.log(`caveman mode: ${result.effectiveThreadFormDefaults.initialCavemanMode}`);
    console.log(`caveman intensity: ${result.effectiveThreadFormDefaults.initialCavemanIntensity}`);
  }
}

export async function preferencesSetCommand(args: CliParsedArgs & JsonArgs & UserSelectorArgs & PreferenceSetArgs): Promise<void> {
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
  if (args.json) printJson(result);
  else {
    console.log(`Updated preferences for ${user.username}.`);
    for (const [key, value] of Object.entries(updates)) console.log(`${key}: ${value}`);
  }
}

export async function serverStartCommand(args: CliParsedArgs): Promise<void> {
  const thread = getCurrentThread();
  const result = await startWorktreeServer(thread.threadId, resolveStartMode(args));
  if (args.json) printJson(result);
  else console.log(result.message);
}

export async function serverStopCommand(args: CliParsedArgs): Promise<void> {
  const thread = getCurrentThread();
  const result = await stopWorktreeServer(thread.threadId);
  if (args.json) printJson(result);
  else console.log(result.message);
}

export async function serverRestartCommand(args: CliParsedArgs): Promise<void> {
  const thread = getCurrentThread();
  const result = await restartWorktreeServer(thread.threadId, resolveStartMode(args));
  if (args.json) printJson(result);
  else console.log(result.message);
}

export async function serverLogsCommand(args: CliParsedArgs & ServiceLogArgs): Promise<void> {
  const thread = getCurrentThread();
  await renderServerLogs(thread.threadId, args);
}

export async function threadLogsCommand(args: CliParsedArgs & ServiceLogArgs): Promise<void> {
  const thread = getCurrentThread();
  await renderLogFile(path.join(thread.path, '.primordia-session.ndjson'), args, {
    rawNdjson: true,
    humanFormatter: formatSessionEventHuman,
  });
}

export async function serverPublishCommand(args: CliParsedArgs): Promise<void> {
  const thread = getCurrentThread();
  const result = await publishProductionBranch(thread.threadId);
  if (args.json) printJson(result);
  else console.log(result.message);
}

export async function serverCopyDbCommand(args: CliParsedArgs): Promise<void> {
  const thread = getCurrentThread();
  const result = await copyProductionDbToWorktree(process.cwd(), thread.path);
  if (args.json) {
    printJson(result);
  } else if (result.copied) {
    console.log(`Copied production DB from ${result.sourcePath} to ${result.destinationPath}`);
  } else {
    console.error(`Failed to copy production DB to ${result.destinationPath}: ${result.error ?? 'unknown error'}`);
  }
  if (!result.copied) process.exit(1);
}

export async function threadCreateCommand(args: CliParsedArgs & JsonArgs & PresetArgs & UserSelectorArgs & AttachArgs): Promise<void> {
  const requestText = await readRequest(args);
  const { user, primordiaAesKey } = await resolveCliAuth(args.user);
  const result = await createThread({
    userId: user.id,
    requestText,
    presetId: await resolveCliPresetIdForUser(user.id, args.preset),
    primordiaAesKey,
    savedAttachmentPaths: resolveAttachmentPaths(args),
    runInBackground: false,
  });
  if (!result.ok) throw cliSecretError(result.error, `thread creation failed (${result.status})`);
  if (args.json) printJson({ ok: true, command: 'thread create', threadId: result.sessionId, worktreePath: result.worktreePath, background: true });
  else console.log(`New thread started in ${result.worktreePath}`);
}

export async function threadFollowupCommand(args: CliParsedArgs & JsonArgs & PresetArgs & UserSelectorArgs & AttachArgs): Promise<void> {
  const requestText = await readRequest(args);
  const { user, primordiaAesKey } = await resolveCliAuth(args.user);
  const threadId = resolveCurrentThreadId();
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
  if (args.json) printJson({ ok: true, command: 'thread followup', thread: threadId, background: true });
  else console.log(`Follow-up started for ${threadId}.`);
}

export async function threadUpdateCommand(args: CliParsedArgs & JsonArgs & UserSelectorArgs): Promise<void> {
  rejectUnexpectedRequestText(args, 'update');
  const user = await resolveCliUser(args.user);
  const threadId = resolveCurrentThreadId();
  const result = await updateThread({ userId: user.id, threadId });
  if (!result.ok) throw new Error(result.error);
  if (args.json) printJson({ ok: true, command: 'thread update', thread: threadId, outcome: result.outcome, log: result.log });
  else {
    console.log(`Updated ${threadId}: ${result.outcome}.`);
    if (result.log.trim()) console.log(result.log.trim());
  }
}

async function handleDecision(args: CliParsedArgs & JsonArgs & UserSelectorArgs, action: 'accept' | 'reject'): Promise<void> {
  rejectUnexpectedRequestText(args, action);
  const auth = action === 'accept'
    ? await resolveCliAuth(args.user)
    : { user: await resolveCliUser(args.user), primordiaAesKey: null };
  const threadId = resolveCurrentThreadId();
  const result = await manageThread({
    userId: auth.user.id,
    threadId,
    action,
    primordiaAesKey: auth.primordiaAesKey,
  });
  if (!result.ok) throw cliSecretError(result.error, 'thread decision failed');
  if (args.json) printJson({ ok: true, command: `thread ${action}`, thread: threadId, outcome: result.outcome });
  else console.log(`${action === 'accept' ? 'Accept' : 'Reject'} started for ${threadId}: ${result.outcome}.`);
}

export function threadAcceptCommand(args: CliParsedArgs & JsonArgs & UserSelectorArgs): Promise<void> {
  return handleDecision(args, 'accept');
}

export function threadRejectCommand(args: CliParsedArgs & JsonArgs & UserSelectorArgs): Promise<void> {
  return handleDecision(args, 'reject');
}
