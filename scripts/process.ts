#!/usr/bin/env bun

import { formatProcessStatusTable, getProcessStatuses } from '../lib/process-manager';

interface Args {
  command: string | null;
  json: boolean;
  watch: boolean;
  intervalMs: number;
}

function printUsage(): void {
  console.log(`Usage: bun run process status [--json] [--watch] [--interval <seconds>]

Commands:
  status      List worktrees, assigned ports, Next.js servers, and active agents.

Options:
  --json      Print machine-readable JSON instead of the table.
  --watch     Refresh output until interrupted.
  --interval  Refresh interval in seconds for --watch (default: 2).`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: null, json: false, watch: false, intervalMs: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--watch') args.watch = true;
    else if (arg === '--interval') {
      const next = argv[++i];
      const seconds = Number.parseFloat(next ?? '');
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('--interval requires a positive number of seconds');
      }
      args.intervalMs = Math.round(seconds * 1000);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (!args.command) {
      args.command = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function render(json: boolean): void {
  const statuses = getProcessStatuses();
  if (json) {
    console.log(JSON.stringify(statuses, null, 2));
  } else {
    console.log(formatProcessStatusTable(statuses));
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== 'status') {
    if (args.command) console.error(`Unknown command: ${args.command}\n`);
    printUsage();
    process.exit(args.command ? 1 : 0);
  }

  if (!args.watch) {
    render(args.json);
    return;
  }

  while (true) {
    process.stdout.write('\x1Bc');
    render(args.json);
    await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
