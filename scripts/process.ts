#!/usr/bin/env bun

import {
  followWorktreeLog,
  formatProcessStatusReport,
  getProcessStatusReport,
  readWorktreeLogLines,
  restartWorktreeServer,
  startWorktreeServer,
  stopWorktreeServer,
  type ServerStartMode,
} from '@/lib/process-manager';

interface Args {
  command: 'status' | 'manage' | null;
  json: boolean;
  follow: boolean;
  worktreeName: string | null;
  action: 'start' | 'stop' | 'restart' | 'logs' | null;
  mode: ServerStartMode;
}

function printUsage(): void {
  console.log(`Usage:
  bun run process status [--json]
  bun run process <worktreename> start [--dev|--prod] [--json]
  bun run process <worktreename> stop [--json]
  bun run process <worktreename> restart [--dev|--prod] [--json]
  bun run process <worktreename> logs [--follow] [--json]

Commands:
  status      List reverse proxy, worktrees, Next.js servers, and active agents.
  start       Start the named worktree's assigned-port Next.js server.
  stop        Stop the named worktree's active server process(es).
  restart     Stop, then start, the named worktree's server.
  logs        Print the named worktree's server log file.

Options:
  --json      Print machine-readable JSON.
  --follow    Keep streaming appended log lines (logs command only).
  --dev       Start with bun run dev (default for start/restart).
  --prod      Start with bun run start.`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: null, json: false, follow: false, worktreeName: null, action: null, mode: 'dev' };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--follow' || arg === '-f') args.follow = true;
    else if (arg === '--dev') args.mode = 'dev';
    else if (arg === '--prod') args.mode = 'prod';
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg === 'status' && !args.command) {
      args.command = 'status';
    } else if ((arg === 'start' || arg === 'stop' || arg === 'restart' || arg === 'logs') && args.worktreeName && !args.action) {
      args.action = arg;
      args.command = 'manage';
    } else if (!args.worktreeName && !args.command) {
      args.worktreeName = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'status') {
    if (args.follow) throw new Error('--follow is only supported for logs');
    renderStatus(args.json);
    return;
  }

  if (args.command === 'manage' && args.worktreeName && args.action) {
    if (args.action === 'start') {
      const result = await startWorktreeServer(args.worktreeName, args.mode);
      if (args.json) printJson(result);
      else console.log(result.message);
    } else if (args.action === 'stop') {
      const result = await stopWorktreeServer(args.worktreeName);
      if (args.json) printJson(result);
      else console.log(result.message);
    } else if (args.action === 'restart') {
      const result = await restartWorktreeServer(args.worktreeName, args.mode);
      if (args.json) printJson(result);
      else console.log(result.message);
    } else {
      await renderLogs(args.worktreeName, args.json, args.follow);
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
