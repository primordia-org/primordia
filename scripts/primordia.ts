#!/usr/bin/env bun

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

interface Args {
  command: 'status' | 'start' | 'stop' | 'restart' | 'logs' | 'publish' | 'copydb' | 'create' | 'followup' | 'update' | 'accept' | 'reject' | null;
  json: boolean;
  follow: boolean;
  worktreeName: string | null;
  mode: ServerStartMode;
  user: string | null;
  presetId: string | null;
  requestParts: string[];
}

function printUsage(): void {
  console.log(`Usage:
  bun run primordia status [--json]
  bun run primordia start [--dev|--prod] [--json] [--worktree <worktreename>]
  bun run primordia stop [--json] [--worktree <worktreename>]
  bun run primordia restart [--dev|--prod] [--json] [--worktree <worktreename>]
  bun run primordia logs [--follow] [--json] [--worktree <worktreename>]
  bun run primordia publish [--json] [--worktree <worktreename>]
  bun run primordia copydb [--json] [--worktree <worktreename>]
  bun run primordia create [--user <id-or-username>] [--preset <id>] "change request"
  bun run primordia followup [--user <id-or-username>] [--preset <id>] "follow-up request"
  bun run primordia update [--user <id-or-username>] [--worktree <worktreename>]
  bun run primordia accept [--user <id-or-username>] [--worktree <worktreename>]
  bun run primordia reject [--user <id-or-username>] [--worktree <worktreename>]

Commands:
  status      List reverse proxy, worktrees, Next.js servers, and active agents.
  start       Start a worktree's assigned-port Next.js server.
  stop        Stop a worktree's active server process(es).
  restart     Stop, then start, a worktree's server.
  logs        Print a worktree's server log file.
  publish     Health-check, then mark a worktree branch as production.
  copydb      VACUUM-copy the production SQLite DB into a worktree.
  create      Create a thread and run its initial agent turn.
  followup    Run a follow-up request on the cwd's thread.
  update      Apply parent/prod updates to the cwd's thread.
  accept      Accept (deploy/merge) the cwd's thread.
  reject      Reject (discard) the cwd's thread.

Options:
  --worktree     Worktree branch, basename, or path. Defaults to the worktree containing cwd.
  --json         Print machine-readable JSON.
  --follow       Keep streaming appended log lines (logs command only).
  --dev          Start with bun run dev (default for start/restart).
  --prod         Start with bun run start.
  --user         Primordia user id or username for thread commands.
  --preset       Preset id. Defaults to the user's saved preset when available.
                 Secret-backed presets require PRIMORDIA_CLI_KEY.
                 Used by create/followup only; accept reuses the thread's recorded billing source.
  request        Pass '-' as the request to read it from stdin.`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: null,
    json: false,
    follow: false,
    worktreeName: null,
    mode: 'dev',
    user: null,
    presetId: null,
    requestParts: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--follow' || arg === '-f') args.follow = true;
    else if (arg === '--dev') args.mode = 'dev';
    else if (arg === '--prod') args.mode = 'prod';
    else if (arg === '--worktree') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--worktree requires a value');
      args.worktreeName = value;
      i += 1;
    } else if (arg.startsWith('--worktree=')) {
      const value = arg.slice('--worktree='.length);
      if (!value) throw new Error('--worktree requires a value');
      args.worktreeName = value;
    } else if (arg === '--user') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--user requires a value');
      args.user = value;
      i += 1;
    } else if (arg.startsWith('--user=')) {
      args.user = arg.slice('--user='.length) || null;
    } else if (arg === '--preset') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--preset requires a value');
      args.presetId = value;
      i += 1;
    } else if (arg.startsWith('--preset=')) {
      args.presetId = arg.slice('--preset='.length) || null;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if ((arg === 'status' || arg === 'start' || arg === 'stop' || arg === 'restart' || arg === 'logs' || arg === 'publish' || arg === 'copydb' || arg === 'create' || arg === 'followup' || arg === 'update' || arg === 'accept' || arg === 'reject') && !args.command) {
      args.command = arg;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    } else if (args.command === 'create' || args.command === 'followup') {
      args.requestParts.push(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

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

function resolveDefaultWorktreeName(report: ProcessStatusReport, cwd = process.cwd()): string {
  const resolvedCwd = realpathIfExists(cwd);
  const matches = report.worktrees
    .map((worktree) => ({ ...worktree, resolvedPath: realpathIfExists(worktree.path) }))
    .filter((worktree) => isPathInside(worktree.resolvedPath, resolvedCwd))
    .sort((a, b) => b.resolvedPath.length - a.resolvedPath.length);

  const match = matches[0];
  if (!match) throw new Error('cwd is not inside a Primordia worktree; pass --worktree <worktreename>');
  if (!match.branch) throw new Error(`cwd is inside detached worktree ${match.path}; pass --worktree <worktreename>`);
  return match.branch;
}

function resolveWorktreeName(explicitName: string | null, report: ProcessStatusReport): string {
  return explicitName ?? resolveDefaultWorktreeName(report);
}

function renderStatus(json: boolean): void {
  const report = getProcessStatusReport();
  if (json) printJson(report);
  else console.log(formatProcessStatusReport(report));
}

async function renderLogs(worktreeName: string, json: boolean, follow: boolean): Promise<void> {
  if (json) {
    if (follow) throw new Error('--json and --follow cannot be combined');
    printJson(readWorktreeLogLines(worktreeName));
    return;
  }

  const lines = readWorktreeLogLines(worktreeName);
  if (lines.length > 0) console.log(lines.join('\n'));
  if (follow) {
    for await (const chunk of followWorktreeLog(worktreeName)) {
      process.stdout.write(chunk);
    }
  }
}

async function readRequest(parts: string[]): Promise<string> {
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

const MISSING_CLI_KEY_MESSAGE =
  'PRIMORDIA_CLI_KEY is required for `primordia create`, `primordia followup`, and `primordia accept`. ' +
  'Open Settings → Primordia CLI in the web app (/settings/cli), create a CLI key, copy the one-time `PRIMORDIA_CLI_KEY=...` value, and export it in this shell before retrying.';

async function resolveCliAuth(selector: string | null): Promise<{ user: { id: string; username: string }; primordiaAesKey: string }> {
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

async function resolveCliUser(selector: string | null): Promise<{ id: string; username: string }> {
  const db = await getDb();
  const user = selector
    ? ((await db.getUserById(selector)) ?? (await db.getUserByUsername(selector)))
    : (() => null)();
  if (user) return user;
  if (selector) throw new Error(`Primordia user not found: ${selector}`);

  const users = await db.getAllUsers();
  if (users.length === 1) return users[0];
  if (users.length === 0) throw new Error('No Primordia users exist yet. Sign in through the web app first.');
  throw new Error('Multiple Primordia users exist; pass --user <id-or-username>.');
}

function resolveDefaultThreadId(): string {
  return resolveDefaultWorktreeName(getProcessStatusReport());
}

async function handleCreate(args: Args): Promise<void> {
  const requestText = await readRequest(args.requestParts);
  const { user, primordiaAesKey } = await resolveCliAuth(args.user);
  const result = await createThread({
    userId: user.id,
    requestText,
    presetId: args.presetId,
    primordiaAesKey,
    runInBackground: true,
    detachBackgroundRunner: true,
  });
  if (!result.ok) throw cliSecretError(result.error, `evolve session creation failed (${result.status})`);
  if (args.json) printJson({ ok: true, command: 'create', sessionId: result.sessionId, worktreePath: result.worktreePath, background: true });
  else console.log(`New thread started in ${result.worktreePath}`);
}

async function handleFollowup(args: Args): Promise<void> {
  const requestText = await readRequest(args.requestParts);
  const { user, primordiaAesKey } = await resolveCliAuth(args.user);
  const threadId = resolveDefaultThreadId();
  const result = await followupThread({
    userId: user.id,
    threadId,
    requestText,
    presetId: args.presetId,
    primordiaAesKey,
    runInBackground: true,
    detachBackgroundRunner: true,
  });
  if (!result.ok) throw cliSecretError(result.error, 'follow-up failed');
  if (args.json) printJson({ ok: true, command: 'followup', thread: threadId, background: true });
  else console.log(`Follow-up started for ${threadId}.`);
}

async function handleUpdate(args: Args): Promise<void> {
  if (args.requestParts.length > 0) throw new Error('update does not accept request text');
  if (args.presetId) throw new Error('--preset is only supported for create and followup');
  const user = await resolveCliUser(args.user);
  const report = getProcessStatusReport();
  const threadId = resolveWorktreeName(args.worktreeName, report);
  const result = await updateThread({ userId: user.id, threadId });
  if (!result.ok) throw new Error(result.error);
  if (args.json) printJson({ ok: true, command: 'update', thread: threadId, outcome: result.outcome, log: result.log });
  else {
    console.log(`Updated ${threadId}: ${result.outcome}.`);
    if (result.log.trim()) console.log(result.log.trim());
  }
}

async function handleDecision(args: Args, action: 'accept' | 'reject'): Promise<void> {
  if (args.requestParts.length > 0) throw new Error(`${action} does not accept request text`);
  if (args.presetId) throw new Error('--preset is only supported for create and followup');
  const auth = action === 'accept'
    ? await resolveCliAuth(args.user)
    : { user: await resolveCliUser(args.user), primordiaAesKey: null };
  const report = getProcessStatusReport();
  const threadId = resolveWorktreeName(args.worktreeName, report);
  const result = await manageThread({
    userId: auth.user.id,
    threadId,
    action,
    primordiaAesKey: auth.primordiaAesKey,
  });
  if (!result.ok) throw cliSecretError(result.error, 'thread decision failed');
  if (args.json) printJson({ ok: true, command: action, thread: threadId, outcome: result.outcome });
  else console.log(`${action === 'accept' ? 'Accept' : 'Reject'} started for ${threadId}: ${result.outcome}.`);
}

async function copyProductionDb(worktreeName: string, report: ProcessStatusReport, json: boolean): Promise<void> {
  const worktree = report.worktrees.find((entry) =>
    entry.branch === worktreeName || path.basename(entry.path) === worktreeName || entry.path === worktreeName,
  );
  if (!worktree) throw new Error(`No worktree found for '${worktreeName}'`);
  if (!worktree.branch) throw new Error(`Worktree '${worktree.path}' is detached and cannot receive a production DB copy`);

  const result = await copyProductionDbToWorktree(process.cwd(), worktree.path);
  if (json) {
    printJson(result);
  } else if (result.copied) {
    console.log(`Copied production DB from ${result.sourcePath} to ${result.destinationPath}`);
  } else {
    console.error(`Failed to copy production DB to ${result.destinationPath}: ${result.error ?? 'unknown error'}`);
  }
  if (!result.copied) process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'status') {
    if (args.follow) throw new Error('--follow is only supported for logs');
    if (args.worktreeName) throw new Error('--worktree is not supported for status');
    renderStatus(args.json);
    return;
  }

  if (args.command === 'create') {
    await handleCreate(args);
    return;
  }

  if (args.command === 'followup') {
    await handleFollowup(args);
    return;
  }

  if (args.command === 'update') {
    await handleUpdate(args);
    return;
  }

  if (args.command === 'accept' || args.command === 'reject') {
    await handleDecision(args, args.command);
    return;
  }

  if (args.command === 'start' || args.command === 'stop' || args.command === 'restart' || args.command === 'logs' || args.command === 'publish' || args.command === 'copydb') {
    const report = getProcessStatusReport();
    const worktreeName = resolveWorktreeName(args.worktreeName, report);

    if (args.command === 'copydb') {
      if (args.follow) throw new Error('--follow is only supported for logs');
      await copyProductionDb(worktreeName, report, args.json);
    } else if (args.command === 'publish') {
      if (args.follow) throw new Error('--follow is only supported for logs');
      const result = await publishProductionBranch(worktreeName);
      if (args.json) printJson(result);
      else console.log(result.message);
    } else if (args.command === 'start') {
      const result = await startWorktreeServer(worktreeName, args.mode);
      if (args.json) printJson(result);
      else console.log(result.message);
    } else if (args.command === 'stop') {
      const result = await stopWorktreeServer(worktreeName);
      if (args.json) printJson(result);
      else console.log(result.message);
    } else if (args.command === 'restart') {
      const result = await restartWorktreeServer(worktreeName, args.mode);
      if (args.json) printJson(result);
      else console.log(result.message);
    } else {
      await renderLogs(worktreeName, args.json, args.follow);
    }
    return;
  }

  printUsage();
  process.exit(1);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (process.argv.includes('--json')) printJson({ ok: false, error: message });
  else console.error(message);
  process.exit(1);
});
