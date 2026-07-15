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
import { copyProductionDbToWorktree } from '@/lib/production-db-copy';

interface Args {
  command: 'status' | 'start' | 'stop' | 'restart' | 'logs' | 'publish' | 'copydb' | null;
  json: boolean;
  follow: boolean;
  worktreeName: string | null;
  mode: ServerStartMode;
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

Commands:
  status      List reverse proxy, worktrees, Next.js servers, and active agents.
  start       Start a worktree's assigned-port Next.js server.
  stop        Stop a worktree's active server process(es).
  restart     Stop, then start, a worktree's server.
  logs        Print a worktree's server log file.
  publish     Health-check, then mark a worktree branch as production.
  copydb      VACUUM-copy the production SQLite DB into a worktree.

Options:
  --worktree  Worktree branch, basename, or path. Defaults to the worktree containing cwd.
  --json      Print machine-readable JSON.
  --follow    Keep streaming appended log lines (logs command only).
  --dev       Start with bun run dev (default for start/restart).
  --prod      Start with bun run start.`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: null, json: false, follow: false, worktreeName: null, mode: 'dev' };

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
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if ((arg === 'status' || arg === 'start' || arg === 'stop' || arg === 'restart' || arg === 'logs' || arg === 'publish' || arg === 'copydb') && !args.command) {
      args.command = arg;
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
