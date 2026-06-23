#!/usr/bin/env bun

import {
  formatProcessStatusReport,
  getProcessStatusReport,
  restartWorktreeServer,
  startWorktreeServer,
  stopWorktreeServer,
  type ServerStartMode,
} from '../lib/process-manager';

interface Args {
  command: 'status' | 'manage' | null;
  json: boolean;
  worktreeName: string | null;
  action: 'start' | 'stop' | 'restart' | null;
  mode: ServerStartMode;
}

function printUsage(): void {
  console.log(`Usage:
  bun run process status [--json]
  bun run process <worktreename> start [--dev|--prod]
  bun run process <worktreename> stop
  bun run process <worktreename> restart [--dev|--prod]

Commands:
  status      List reverse proxy, worktrees, Next.js servers, and active agents.
  start       Start the named worktree's assigned-port Next.js server.
  stop        Stop the named worktree's active server process(es).
  restart     Stop, then start, the named worktree's server.

Options:
  --json      Print machine-readable status JSON instead of the table.
  --dev       Start with bun run dev (default for start/restart).
  --prod      Start with bun run start.`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: null, json: false, worktreeName: null, action: null, mode: 'dev' };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--dev') args.mode = 'dev';
    else if (arg === '--prod') args.mode = 'prod';
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg === 'status' && !args.command) {
      args.command = 'status';
    } else if ((arg === 'start' || arg === 'stop' || arg === 'restart') && args.worktreeName && !args.action) {
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

function renderStatus(json: boolean): void {
  const report = getProcessStatusReport();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatProcessStatusReport(report));
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'status') {
    renderStatus(args.json);
    return;
  }

  if (args.command === 'manage' && args.worktreeName && args.action) {
    if (args.json) throw new Error('--json is only supported for status');
    if (args.action === 'start') console.log(startWorktreeServer(args.worktreeName, args.mode));
    else if (args.action === 'stop') console.log(await stopWorktreeServer(args.worktreeName));
    else console.log(await restartWorktreeServer(args.worktreeName, args.mode));
    return;
  }

  printUsage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
