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
import { createThread, followupThread, type LocalSession } from '@/lib/threads';
import { getDb } from '@/lib/db';
import { hasEvolvePermission } from '@/lib/auth';
import { DEFAULT_HARNESS, DEFAULT_MODEL } from '@/lib/agent-config';
import { PREF_HARNESS, PREF_MODEL } from '@/lib/user-prefs';
import {
  BUILT_IN_PRESETS,
  PREF_CUSTOM_PRESETS,
  PREF_PRESET,
  normalizeAuthSource,
  parseCustomPresets,
  type EvolvePreset,
  type PresetAuthSource,
} from '@/lib/presets';
import { getSessionFromFilesystem, readSessionEvents, getSessionNdjsonPath } from '@/lib/session-events';

interface Args {
  command: 'status' | 'start' | 'stop' | 'restart' | 'logs' | 'publish' | 'create' | 'followup' | null;
  json: boolean;
  follow: boolean;
  worktreeName: string | null;
  mode: ServerStartMode;
  user: string | null;
  harness: string | null;
  model: string | null;
  presetId: string | null;
  authSource: PresetAuthSource | null;
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
  bun run primordia create [--user <id-or-username>] [--preset <id>] [--auth-source <source>] "change request"
  bun run primordia followup [--user <id-or-username>] "follow-up request"

Commands:
  status      List reverse proxy, worktrees, Next.js servers, and active agents.
  start       Start a worktree's assigned-port Next.js server.
  stop        Stop a worktree's active server process(es).
  restart     Stop, then start, a worktree's server.
  logs        Print a worktree's server log file.
  publish     Health-check, then mark a worktree branch as production.
  create      Create a thread and run its initial agent turn.
  followup    Run a follow-up request on the cwd's thread.

Options:
  --worktree     Worktree branch, basename, or path. Defaults to the worktree containing cwd.
  --json         Print machine-readable JSON.
  --follow       Keep streaming appended log lines (logs command only).
  --dev          Start with bun run dev (default for start/restart).
  --prod         Start with bun run start.
  --user         Primordia user id or username for thread commands.
  --preset       Preset id. Defaults to the user's saved preset when available.
  --harness      Agent harness id for create/followup when not using a preset.
  --model        Model id for create/followup when not using a preset.
  --auth-source  Billing source. Secret-backed sources require PRIMORDIA_AES_KEY.
                 Pass '-' as the request to read it from stdin.`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: null,
    json: false,
    follow: false,
    worktreeName: null,
    mode: 'dev',
    user: null,
    harness: null,
    model: null,
    presetId: null,
    authSource: null,
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
    } else if (arg === '--harness') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--harness requires a value');
      args.harness = value;
      i += 1;
    } else if (arg.startsWith('--harness=')) {
      args.harness = arg.slice('--harness='.length) || null;
    } else if (arg === '--model') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--model requires a value');
      args.model = value;
      i += 1;
    } else if (arg.startsWith('--model=')) {
      args.model = arg.slice('--model='.length) || null;
    } else if (arg === '--preset') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--preset requires a value');
      args.presetId = value;
      i += 1;
    } else if (arg.startsWith('--preset=')) {
      args.presetId = arg.slice('--preset='.length) || null;
    } else if (arg === '--auth-source') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--auth-source requires a value');
      args.authSource = normalizeAuthSource(value);
      if (!args.authSource) throw new Error(`Unknown auth source: ${value}`);
      i += 1;
    } else if (arg.startsWith('--auth-source=')) {
      const value = arg.slice('--auth-source='.length);
      args.authSource = normalizeAuthSource(value);
      if (!args.authSource) throw new Error(`Unknown auth source: ${value}`);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if ((arg === 'status' || arg === 'start' || arg === 'stop' || arg === 'restart' || arg === 'logs' || arg === 'publish' || arg === 'create' || arg === 'followup') && !args.command) {
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

async function resolveEvolveSelection(args: Args, userId: string): Promise<{ harness: string; model: string; presetId: string | null; authSource: PresetAuthSource | null }> {
  const db = await getDb();
  const prefs = await db.getUserPreferences(userId, [PREF_HARNESS, PREF_MODEL, PREF_PRESET, PREF_CUSTOM_PRESETS]);
  const customPresets = parseCustomPresets(prefs[PREF_CUSTOM_PRESETS]);
  const presets: EvolvePreset[] = [...BUILT_IN_PRESETS, ...customPresets];
  const presetId = args.presetId ?? prefs[PREF_PRESET] ?? null;
  const preset = presetId ? presets.find((candidate) => candidate.id === presetId) : null;
  if (presetId && !preset) throw new Error(`Evolve preset not found: ${presetId}`);

  return {
    harness: args.harness ?? preset?.harness ?? prefs[PREF_HARNESS] ?? DEFAULT_HARNESS,
    model: args.model ?? preset?.model ?? prefs[PREF_MODEL] ?? DEFAULT_MODEL,
    presetId: preset?.id ?? null,
    authSource: args.authSource ?? preset?.authSource ?? null,
  };
}

function resolveDefaultThreadId(): string {
  return resolveDefaultWorktreeName(getProcessStatusReport());
}

async function localSessionForThread(threadId: string, userId: string, args: Args): Promise<LocalSession> {
  const record = getSessionFromFilesystem(threadId, process.cwd());
  if (!record) throw new Error(`Evolve thread not found: ${threadId}`);
  const events = readSessionEvents(getSessionNdjsonPath(record.worktreePath)).events;
  const initial = events.find((event) => event.type === 'initial_request') as
    | Extract<(typeof events)[number], { type: 'initial_request' }>
    | undefined;
  const selection = await resolveEvolveSelection(args, userId);
  return {
    id: record.id,
    branch: record.branch,
    worktreePath: record.worktreePath,
    status: record.status as LocalSession['status'],
    devServerStatus: record.previewUrl ? 'running' : 'none',
    port: record.port,
    previewUrl: record.previewUrl,
    request: record.request,
    createdAt: record.createdAt,
    harness: args.harness ?? initial?.harness ?? selection.harness,
    model: args.model ?? initial?.model ?? selection.model,
    aesKey: process.env.PRIMORDIA_AES_KEY,
    authSource: args.authSource ?? normalizeAuthSource(initial?.authSource ?? '') ?? selection.authSource,
    userId,
  };
}

async function handleCreate(args: Args): Promise<void> {
  const requestText = await readRequest(args.requestParts);
  const user = await resolveCliUser(args.user);
  if (!(await hasEvolvePermission(user.id))) throw new Error(`User ${user.username} does not have evolve permission.`);
  const selection = await resolveEvolveSelection(args, user.id);
  const result = await createThread({
    userId: user.id,
    requestText,
    harness: selection.harness,
    model: selection.model,
    presetId: selection.presetId,
    authSource: selection.authSource,
    primordiaAesKey: process.env.PRIMORDIA_AES_KEY ?? null,
    runInBackground: false,
  });
  if (!result.ok) throw new Error(result.error ?? `evolve session creation failed (${result.status})`);
  if (args.json) printJson({ ok: true, command: 'create', sessionId: result.sessionId });
  else console.log(`Thread ${result.sessionId} complete. Open /evolve/session/${result.sessionId}`);
}

async function handleFollowup(args: Args): Promise<void> {
  const requestText = await readRequest(args.requestParts);
  const user = await resolveCliUser(args.user);
  if (!(await hasEvolvePermission(user.id))) throw new Error(`User ${user.username} does not have evolve permission.`);
  const threadId = resolveDefaultThreadId();
  const session = await localSessionForThread(threadId, user.id, args);
  await followupThread(session, requestText, process.cwd());
  if (args.json) printJson({ ok: true, command: 'followup', thread: threadId });
  else console.log(`Follow-up complete for ${threadId}.`);
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

  if (args.command === 'start' || args.command === 'stop' || args.command === 'restart' || args.command === 'logs' || args.command === 'publish') {
    const report = getProcessStatusReport();
    const worktreeName = resolveWorktreeName(args.worktreeName, report);

    if (args.command === 'publish') {
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
