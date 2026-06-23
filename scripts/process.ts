#!/usr/bin/env bun

import { formatProcessStatusTable, getProcessStatuses } from '../lib/process-manager';

interface Args {
  command: string | null;
  json: boolean;
}

function printUsage(): void {
  console.log(`Usage: bun run process status [--json]

Commands:
  status      List worktrees, assigned ports, Next.js servers, and active agents.

Options:
  --json      Print machine-readable JSON instead of the table.`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') {
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

  render(args.json);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
