#!/usr/bin/env bun

import { CliUsageError, ProcessExit } from '@/lib/tiny-command/common';
import { runCli } from '@/lib/tiny-command/cli';
import { applyCurrentProcessOomRole } from '@/lib/oom-priority';
import { mainCommand } from './primordia-command-handlers';

applyCurrentProcessOomRole('command', (message) => console.warn(`[primordia-cli] ${message}`));

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  try {
    await runCli(mainCommand, rawArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ProcessExit) {
      process.exit(err.code);
    }
    if (rawArgs.includes('--json')) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(message);
    process.exit(err instanceof CliUsageError ? 64 : 1);
  }
}

if (import.meta.main) main();
