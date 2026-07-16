#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import { defineCommand, renderUsage, runCommand, runMain, type ArgsDef } from 'citty';
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

type UserSelectorArgs = { user?: string };
type JsonArgs = { json?: boolean };
type ModeArgs = { dev?: boolean; prod?: boolean };
type PresetArgs = { preset?: string };
type CittyArgs = Record<string, unknown> & { _: string[] };

const jsonArg = {
  json: {
    type: 'boolean',
    description: 'Print machine-readable JSON.',
  },
} satisfies ArgsDef;

const modeArgs = {
  dev: {
    type: 'boolean',
    description: 'Start with bun run dev. This is the default.',
  },
  prod: {
    type: 'boolean',
    description: 'Start with bun run start.',
  },
} satisfies ArgsDef;

const userArg = {
  user: {
    type: 'string',
    valueHint: 'id-or-username',
    description: 'Primordia user id or username for thread commands.',
  },
} satisfies ArgsDef;

const presetArg = {
  preset: {
    type: 'string',
    valueHint: 'id',
    description: "Preset id. Defaults to the user's saved preset when available.",
  },
} satisfies ArgsDef;

const requestArg = {
  request: {
    type: 'positional',
    required: false,
    valueHint: 'request',
    description: "Change request text. Pass '-' to read it from stdin.",
  },
} satisfies ArgsDef;

const MISSING_CLI_KEY_MESSAGE =
  'PRIMORDIA_CLI_KEY is required for `primordia thread create`, `primordia thread followup`, and `primordia thread accept`. ' +
  'Open Settings → Primordia CLI in the web app (/settings/cli), create a CLI key, copy the one-time `PRIMORDIA_CLI_KEY=...` value, and export it in this shell before retrying.';

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function rejectUnknownOptions(rawArgs: string[], argsDef: ArgsDef): void {
  const knownLongNames = new Map<string, ArgsDef[string]>();
  const knownShortNames = new Map<string, ArgsDef[string]>();

  for (const [name, def] of Object.entries(argsDef)) {
    if (def.type === 'positional') continue;
    knownLongNames.set(name, def);
    knownLongNames.set(name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`), def);
    const aliasValue = 'alias' in def ? def.alias : undefined;
    const aliases = Array.isArray(aliasValue) ? aliasValue : aliasValue ? [aliasValue] : [];
    for (const alias of aliases) {
      if (alias.length === 1) knownShortNames.set(alias, def);
      else knownLongNames.set(alias, def);
    }
  }

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (token === '--') return;
    if (token === '-' || !token.startsWith('-')) continue;

    if (token.startsWith('--')) {
      const [rawName, inlineValue] = token.slice(2).split('=', 2);
      const negated = rawName.startsWith('no-');
      const name = negated ? rawName.slice(3) : rawName;
      const def = knownLongNames.get(name);
      if (!def) throw new Error(`Unknown option: --${rawName}`);
      if (negated && def.type !== 'boolean') throw new Error(`--${rawName} is only valid for boolean options`);
      if (def.type === 'string' || def.type === 'enum') {
        if (token.includes('=')) {
          if (!inlineValue) throw new Error(`--${name} requires a value`);
        } else {
          const next = rawArgs[index + 1];
          if (!next || (next.startsWith('-') && next !== '-')) throw new Error(`--${name} requires a value`);
          index += 1;
        }
      }
      continue;
    }

    const shortNames = token.slice(1).split('');
    if (shortNames.length > 1) throw new Error(`Unknown option: ${token}. Use separate short flags instead.`);
    const [shortName] = shortNames;
    const def = knownShortNames.get(shortName);
    if (!def) throw new Error(`Unknown option: -${shortName}`);
    if (def.type === 'string' || def.type === 'enum') {
      const next = rawArgs[index + 1];
      if (!next || (next.startsWith('-') && next !== '-')) throw new Error(`-${shortName} requires a value`);
      index += 1;
    }
  }
}

function strictSetup(argsDef: ArgsDef): (context: { rawArgs: string[] }) => void {
  return ({ rawArgs }) => rejectUnknownOptions(rawArgs, argsDef);
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

function resolveStartMode(args: ModeArgs): ServerStartMode {
  if (args.dev && args.prod) throw new Error('--dev and --prod cannot be combined');
  return args.prod ? 'prod' : 'dev';
}

function renderStatus(json: boolean | undefined): void {
  const report = getProcessStatusReport();
  if (json) printJson(report);
  else console.log(formatProcessStatusReport(report));
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

async function readRequest(args: CittyArgs): Promise<string> {
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

async function handleCreate(args: CittyArgs & JsonArgs & PresetArgs & UserSelectorArgs): Promise<void> {
  const requestText = await readRequest(args);
  const { user, primordiaAesKey } = await resolveCliAuth(args.user);
  const result = await createThread({
    userId: user.id,
    requestText,
    presetId: args.preset,
    primordiaAesKey,
    runInBackground: false,
  });
  if (!result.ok) throw cliSecretError(result.error, `thread creation failed (${result.status})`);
  if (args.json) printJson({ ok: true, command: 'thread create', threadId: result.sessionId, worktreePath: result.worktreePath, background: true });
  else console.log(`New thread started in ${result.worktreePath}`);
}

async function handleFollowup(args: CittyArgs & JsonArgs & PresetArgs & UserSelectorArgs): Promise<void> {
  const requestText = await readRequest(args);
  const { user, primordiaAesKey } = await resolveCliAuth(args.user);
  const threadId = resolveCurrentThreadId();
  const result = await followupThread({
    userId: user.id,
    threadId,
    requestText,
    presetId: args.preset,
    primordiaAesKey,
    runInBackground: false,
  });
  if (!result.ok) throw cliSecretError(result.error, 'follow-up failed');
  if (args.json) printJson({ ok: true, command: 'thread followup', thread: threadId, background: true });
  else console.log(`Follow-up started for ${threadId}.`);
}

async function handleUpdate(args: CittyArgs & JsonArgs & UserSelectorArgs): Promise<void> {
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

async function handleDecision(args: CittyArgs & JsonArgs & UserSelectorArgs, action: 'accept' | 'reject'): Promise<void> {
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

function rejectUnexpectedRequestText(args: CittyArgs, command: string): void {
  if (args._.length > 0) throw new Error(`${command} does not accept request text`);
}

async function copyProductionDb(thread: { threadId: string; path: string }, json: boolean | undefined): Promise<void> {
  const result = await copyProductionDbToWorktree(process.cwd(), thread.path);
  if (json) {
    printJson(result);
  } else if (result.copied) {
    console.log(`Copied production DB from ${result.sourcePath} to ${result.destinationPath}`);
  } else {
    console.error(`Failed to copy production DB to ${result.destinationPath}: ${result.error ?? 'unknown error'}`);
  }
  if (!result.copied) process.exit(1);
}

function getCurrentThread(): { threadId: string; path: string } {
  return resolveCurrentThread(getProcessStatusReport());
}

const statusArgs = { ...jsonArg } satisfies ArgsDef;
const startArgs = { ...jsonArg, ...modeArgs } satisfies ArgsDef;
const serverJsonArgs = { ...jsonArg } satisfies ArgsDef;
const logsArgs = {
  ...jsonArg,
  follow: {
    type: 'boolean',
    alias: 'f',
    description: 'Keep streaming appended log lines.',
  },
} satisfies ArgsDef;
const requestCommandArgs = { ...jsonArg, ...userArg, ...presetArg, ...requestArg } satisfies ArgsDef;
const threadCommandArgs = { ...jsonArg, ...userArg } satisfies ArgsDef;

const statusCommand = defineCommand({
  meta: { name: 'status', description: 'List reverse proxy, threads, Next.js servers, and active agents.' },
  args: statusArgs,
  setup: strictSetup(statusArgs),
  run({ args }) {
    renderStatus(args.json);
  },
});

const startCommand = defineCommand({
  meta: { name: 'start', description: "Start the thread's Next.js server." },
  args: startArgs,
  setup: strictSetup(startArgs),
  async run({ args }) {
    const thread = getCurrentThread();
    const result = await startWorktreeServer(thread.threadId, resolveStartMode(args));
    if (args.json) printJson(result);
    else console.log(result.message);
  },
});

const stopCommand = defineCommand({
  meta: { name: 'stop', description: "Stop the thread's active server process(es)." },
  args: serverJsonArgs,
  setup: strictSetup(serverJsonArgs),
  async run({ args }) {
    const thread = getCurrentThread();
    const result = await stopWorktreeServer(thread.threadId);
    if (args.json) printJson(result);
    else console.log(result.message);
  },
});

const restartCommand = defineCommand({
  meta: { name: 'restart', description: "Stop, then start, the thread's server." },
  args: startArgs,
  setup: strictSetup(startArgs),
  async run({ args }) {
    const thread = getCurrentThread();
    const result = await restartWorktreeServer(thread.threadId, resolveStartMode(args));
    if (args.json) printJson(result);
    else console.log(result.message);
  },
});

const logsCommand = defineCommand({
  meta: { name: 'logs', description: "Print the thread's server log file." },
  args: logsArgs,
  setup: strictSetup(logsArgs),
  async run({ args }) {
    const thread = getCurrentThread();
    await renderLogs(thread.threadId, args.json, args.follow ?? args.f);
  },
});

const publishCommand = defineCommand({
  meta: { name: 'publish', description: "Health-check the thread's server, then promote it to production." },
  args: serverJsonArgs,
  setup: strictSetup(serverJsonArgs),
  async run({ args }) {
    const thread = getCurrentThread();
    const result = await publishProductionBranch(thread.threadId);
    if (args.json) printJson(result);
    else console.log(result.message);
  },
});

const copyDbCommand = defineCommand({
  meta: { name: 'copydb', description: 'Safely copy the production SQLite DB into the thread.' },
  args: serverJsonArgs,
  setup: strictSetup(serverJsonArgs),
  async run({ args }) {
    await copyProductionDb(getCurrentThread(), args.json);
  },
});

const createCommand = defineCommand({
  meta: { name: 'create', description: 'Create a thread and run its initial agent turn.' },
  args: requestCommandArgs,
  setup: strictSetup(requestCommandArgs),
  run({ args }) {
    return handleCreate(args);
  },
});

const followupCommand = defineCommand({
  meta: { name: 'followup', description: 'Run a follow-up request on the current thread.' },
  args: requestCommandArgs,
  setup: strictSetup(requestCommandArgs),
  run({ args }) {
    return handleFollowup(args);
  },
});

const updateCommand = defineCommand({
  meta: { name: 'update', description: 'Apply parent/prod updates to the current thread.' },
  args: threadCommandArgs,
  setup: strictSetup(threadCommandArgs),
  run({ args }) {
    return handleUpdate(args);
  },
});

const acceptCommand = defineCommand({
  meta: { name: 'accept', description: 'Accept (deploy/merge) the current thread.' },
  args: threadCommandArgs,
  setup: strictSetup(threadCommandArgs),
  run({ args }) {
    return handleDecision(args, 'accept');
  },
});

const rejectCommand = defineCommand({
  meta: { name: 'reject', description: 'Reject (discard) the current thread.' },
  args: threadCommandArgs,
  setup: strictSetup(threadCommandArgs),
  run({ args }) {
    return handleDecision(args, 'reject');
  },
});

const threadCommand = defineCommand({
  meta: { name: 'thread', description: 'Manage Primordia agentic coding threads.' },
  subCommands: {
    create: createCommand,
    followup: followupCommand,
    update: updateCommand,
    accept: acceptCommand,
    reject: rejectCommand,
  },
});

const serverCommand = defineCommand({
  meta: { name: 'server', description: 'Manage the current thread server process.' },
  subCommands: {
    start: startCommand,
    stop: stopCommand,
    restart: restartCommand,
    logs: logsCommand,
    publish: publishCommand,
    copydb: copyDbCommand,
  },
});

const mainCommand = defineCommand({
  meta: {
    name: 'primordia',
    description: 'Manage Primordia thread and server lifecycle tasks.',
  },
  subCommands: {
    status: statusCommand,
    thread: threadCommand,
    server: serverCommand,
  },
});

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    await runMain(mainCommand, { rawArgs });
    return;
  }

  try {
    await runCommand(mainCommand, { rawArgs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (rawArgs.includes('--json')) printJson({ ok: false, error: message });
    else {
      if (message === 'No command specified.') console.error(`${await renderUsage(mainCommand)}\n`);
      console.error(message);
    }
    process.exit(1);
  }
}

main();
