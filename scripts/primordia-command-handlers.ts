import * as fs from 'fs';
import * as path from 'path';
import {
  followWorktreeLog,
  formatProcessStatusReport,
  getProcessStatusReport,
  readWorktreeLogLines,
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
  formatJobInterval,
  isPrimordiaJobName,
  listJobSchedules,
  parseJobInterval,
  runPrimordiaJobOnce,
  runPrimordiaJobs,
  setJobScheduleInterval,
  type PrimordiaJobName,
} from '@/lib/primordia-jobs';
import { resolveCliPresetIdForUser } from './primordia-preset-helpers';
import type { CliParsedArgs } from '@/lib/tiny-cli';

type UserSelectorArgs = { user?: string };
type JsonArgs = { json?: boolean };
type ModeArgs = { dev?: boolean; prod?: boolean };
type PresetArgs = { preset?: string };

const MISSING_CLI_KEY_MESSAGE =
  'PRIMORDIA_CLI_KEY is required for `primordia thread create`, `primordia thread followup`, and `primordia thread accept`. ' +
  'Open Settings → Primordia CLI in the web app (/settings/cli), create a CLI key, copy the one-time `PRIMORDIA_CLI_KEY=...` value, and export it in this shell before retrying.';

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

async function renderLogs(threadId: string, json: boolean | undefined, follow: boolean | undefined): Promise<void> {
  if (json) {
    if (follow) throw new Error('--json and --follow cannot be combined');
    printJson(readWorktreeLogLines(threadId));
    return;
  }

  const lines = readWorktreeLogLines(threadId);
  if (lines.length > 0) console.log(lines.join('\n'));
  if (follow) {
    for await (const chunk of followWorktreeLog(threadId)) {
      process.stdout.write(chunk);
    }
  }
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

export async function completeUsers(): Promise<string[]> {
  const db = await getDb();
  const users = await db.getAllUsers();
  return users.flatMap((user) => [user.username, user.id]);
}

export function completeJobNames(): string[] {
  return listJobSchedules().map((schedule) => schedule.name);
}

export function statusCommand(args: CliParsedArgs & JsonArgs): void {
  const report = getProcessStatusReport();
  if (args.json) printJson(report);
  else console.log(formatProcessStatusReport(report));
}

export async function jobsRunCommand(args: CliParsedArgs & JsonArgs): Promise<void> {
  const started = runPrimordiaJobs({ repoRoot: process.cwd() });
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

export async function serverLogsCommand(args: CliParsedArgs): Promise<void> {
  const thread = getCurrentThread();
  await renderLogs(thread.threadId, Boolean(args.json), Boolean(args.follow ?? args.f));
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

export async function threadCreateCommand(args: CliParsedArgs & JsonArgs & PresetArgs & UserSelectorArgs): Promise<void> {
  const requestText = await readRequest(args);
  const { user, primordiaAesKey } = await resolveCliAuth(args.user);
  const result = await createThread({
    userId: user.id,
    requestText,
    presetId: await resolveCliPresetIdForUser(user.id, args.preset),
    primordiaAesKey,
    runInBackground: false,
  });
  if (!result.ok) throw cliSecretError(result.error, `thread creation failed (${result.status})`);
  if (args.json) printJson({ ok: true, command: 'thread create', threadId: result.sessionId, worktreePath: result.worktreePath, background: true });
  else console.log(`New thread started in ${result.worktreePath}`);
}

export async function threadFollowupCommand(args: CliParsedArgs & JsonArgs & PresetArgs & UserSelectorArgs): Promise<void> {
  const requestText = await readRequest(args);
  const { user, primordiaAesKey } = await resolveCliAuth(args.user);
  const threadId = resolveCurrentThreadId();
  const result = await followupThread({
    userId: user.id,
    threadId,
    requestText,
    presetId: await resolveCliPresetIdForUser(user.id, args.preset),
    primordiaAesKey,
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
