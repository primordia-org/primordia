#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import {
  runCli,
  type CliArgumentDef,
  type CliCommandDef,
  type CliOptionDef,
  type CliParsedArgs,
} from '@/lib/tiny-cli';
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
import { BUILT_IN_PRESETS } from '@/lib/presets';

type UserSelectorArgs = { user?: string };
type JsonArgs = { json?: boolean };
type ModeArgs = { dev?: boolean; prod?: boolean };
type PresetArgs = { preset?: string };

const jsonOption: CliOptionDef = {
  name: 'json',
  type: 'boolean',
  description: 'Print machine-readable JSON.',
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
  async complete() {
    const db = await getDb();
    const users = await db.getAllUsers();
    return users.flatMap((user) => [user.username, user.id]);
  },
};

const presetOption: CliOptionDef = {
  name: 'preset',
  type: 'string',
  valueHint: 'id',
  description: "Preset id. Defaults to the user's saved preset when available.",
  complete() {
    return BUILT_IN_PRESETS.map((preset) => preset.id);
  },
};

const followOption: CliOptionDef = {
  name: 'follow',
  alias: 'f',
  type: 'boolean',
  description: 'Keep streaming appended log lines.',
};

const requestArgument: CliArgumentDef = {
  name: 'request',
  required: false,
  valueHint: 'request',
  description: "Change request text. Pass '-' to read it from stdin.",
};

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

async function handleCreate(args: CliParsedArgs & JsonArgs & PresetArgs & UserSelectorArgs): Promise<void> {
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

async function handleFollowup(args: CliParsedArgs & JsonArgs & PresetArgs & UserSelectorArgs): Promise<void> {
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

async function handleUpdate(args: CliParsedArgs & JsonArgs & UserSelectorArgs): Promise<void> {
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

function rejectUnexpectedRequestText(args: CliParsedArgs, command: string): void {
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

const statusCommand: CliCommandDef = {
  name: 'status',
  description: 'List reverse proxy, threads, Next.js servers, and active agents.',
  options: [jsonOption],
  run({ args }) {
    renderStatus(Boolean(args.json));
  },
};

const startCommand: CliCommandDef = {
  name: 'start',
  description: "Start the thread's Next.js server.",
  options: [jsonOption, devOption, prodOption],
  async run({ args }) {
    const thread = getCurrentThread();
    const result = await startWorktreeServer(thread.threadId, resolveStartMode(args));
    if (args.json) printJson(result);
    else console.log(result.message);
  },
};

const stopCommand: CliCommandDef = {
  name: 'stop',
  description: "Stop the thread's active server process(es).",
  options: [jsonOption],
  async run({ args }) {
    const thread = getCurrentThread();
    const result = await stopWorktreeServer(thread.threadId);
    if (args.json) printJson(result);
    else console.log(result.message);
  },
};

const restartCommand: CliCommandDef = {
  name: 'restart',
  description: "Stop, then start, the thread's server.",
  options: [jsonOption, devOption, prodOption],
  async run({ args }) {
    const thread = getCurrentThread();
    const result = await restartWorktreeServer(thread.threadId, resolveStartMode(args));
    if (args.json) printJson(result);
    else console.log(result.message);
  },
};

const logsCommand: CliCommandDef = {
  name: 'logs',
  description: "Print the thread's server log file.",
  options: [jsonOption, followOption],
  async run({ args }) {
    const thread = getCurrentThread();
    await renderLogs(thread.threadId, Boolean(args.json), Boolean(args.follow ?? args.f));
  },
};

const publishCommand: CliCommandDef = {
  name: 'publish',
  description: "Health-check the thread's server, then promote it to production.",
  options: [jsonOption],
  async run({ args }) {
    const thread = getCurrentThread();
    const result = await publishProductionBranch(thread.threadId);
    if (args.json) printJson(result);
    else console.log(result.message);
  },
};

const copyDbCommand: CliCommandDef = {
  name: 'copydb',
  description: 'Safely copy the production SQLite DB into the thread.',
  options: [jsonOption],
  async run({ args }) {
    await copyProductionDb(getCurrentThread(), Boolean(args.json));
  },
};

const createCommand: CliCommandDef = {
  name: 'create',
  description: 'Create a thread and run its initial agent turn.',
  options: [jsonOption, userOption, presetOption],
  arguments: [requestArgument],
  run({ args }) {
    return handleCreate(args);
  },
};

const followupCommand: CliCommandDef = {
  name: 'followup',
  description: 'Run a follow-up request on the current thread.',
  options: [jsonOption, userOption, presetOption],
  arguments: [requestArgument],
  run({ args }) {
    return handleFollowup(args);
  },
};

const updateCommand: CliCommandDef = {
  name: 'update',
  description: 'Apply parent/prod updates to the current thread.',
  options: [jsonOption, userOption],
  run({ args }) {
    return handleUpdate(args);
  },
};

const acceptCommand: CliCommandDef = {
  name: 'accept',
  description: 'Accept (deploy/merge) the current thread.',
  options: [jsonOption, userOption],
  run({ args }) {
    return handleDecision(args, 'accept');
  },
};

const rejectCommand: CliCommandDef = {
  name: 'reject',
  description: 'Reject (discard) the current thread.',
  options: [jsonOption, userOption],
  run({ args }) {
    return handleDecision(args, 'reject');
  },
};

const threadCommand: CliCommandDef = {
  name: 'thread',
  description: 'Manage Primordia agentic coding threads.',
  subcommands: [createCommand, followupCommand, updateCommand, acceptCommand, rejectCommand],
};

const serverCommand: CliCommandDef = {
  name: 'server',
  description: 'Manage the current thread server process.',
  subcommands: [startCommand, stopCommand, restartCommand, logsCommand, publishCommand, copyDbCommand],
};

const mainCommand: CliCommandDef = {
  name: 'primordia',
  description: 'Manage Primordia thread and server lifecycle tasks.',
  subcommands: [statusCommand, threadCommand, serverCommand],
};

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  try {
    await runCli(mainCommand, rawArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (rawArgs.includes('--json')) printJson({ ok: false, error: message });
    else console.error(message);
    process.exit(1);
  }
}

main();
