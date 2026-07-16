#!/usr/bin/env bun

import {
  runCli,
  type CliArgumentDef,
  type CliCommandDef,
  type CliOptionDef,
  type CliParsedArgs,
} from '@/lib/tiny-cli';
import { BUILT_IN_PRESETS } from '@/lib/presets';

const COMMAND_HANDLERS_MODULE = './primordia-command-handlers';

function importCommandHandlers(): Promise<typeof import('./primordia-command-handlers')> {
  return import(COMMAND_HANDLERS_MODULE);
}

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
  complete() {
    return importCommandHandlers().then((handlers) => handlers.completeUsers());
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

function lazyRun(name: keyof typeof import('./primordia-command-handlers')) {
  return async ({ args }: { args: CliParsedArgs }) => {
    const handlers = await importCommandHandlers();
    const handler = handlers[name] as (args: CliParsedArgs) => unknown | Promise<unknown>;
    return handler(args);
  };
}

const statusCommand: CliCommandDef = {
  name: 'status',
  description: 'List reverse proxy, threads, Next.js servers, and active agents.',
  options: [jsonOption],
  run: lazyRun('statusCommand'),
};

const startCommand: CliCommandDef = {
  name: 'start',
  description: "Start the thread's Next.js server.",
  options: [jsonOption, devOption, prodOption],
  run: lazyRun('serverStartCommand'),
};

const stopCommand: CliCommandDef = {
  name: 'stop',
  description: "Stop the thread's active server process(es).",
  options: [jsonOption],
  run: lazyRun('serverStopCommand'),
};

const restartCommand: CliCommandDef = {
  name: 'restart',
  description: "Stop, then start, the thread's server.",
  options: [jsonOption, devOption, prodOption],
  run: lazyRun('serverRestartCommand'),
};

const logsCommand: CliCommandDef = {
  name: 'logs',
  description: "Print the thread's server log file.",
  options: [jsonOption, followOption],
  run: lazyRun('serverLogsCommand'),
};

const publishCommand: CliCommandDef = {
  name: 'publish',
  description: "Health-check the thread's server, then promote it to production.",
  options: [jsonOption],
  run: lazyRun('serverPublishCommand'),
};

const copyDbCommand: CliCommandDef = {
  name: 'copydb',
  description: 'Safely copy the production SQLite DB into the thread.',
  options: [jsonOption],
  run: lazyRun('serverCopyDbCommand'),
};

const createCommand: CliCommandDef = {
  name: 'create',
  description: 'Create a thread and run its initial agent turn.',
  options: [jsonOption, userOption, presetOption],
  arguments: [requestArgument],
  run: lazyRun('threadCreateCommand'),
};

const followupCommand: CliCommandDef = {
  name: 'followup',
  description: 'Run a follow-up request on the current thread.',
  options: [jsonOption, userOption, presetOption],
  arguments: [requestArgument],
  run: lazyRun('threadFollowupCommand'),
};

const updateCommand: CliCommandDef = {
  name: 'update',
  description: 'Apply parent/prod updates to the current thread.',
  options: [jsonOption, userOption],
  run: lazyRun('threadUpdateCommand'),
};

const acceptCommand: CliCommandDef = {
  name: 'accept',
  description: 'Accept (deploy/merge) the current thread.',
  options: [jsonOption, userOption],
  run: lazyRun('threadAcceptCommand'),
};

const rejectCommand: CliCommandDef = {
  name: 'reject',
  description: 'Reject (discard) the current thread.',
  options: [jsonOption, userOption],
  run: lazyRun('threadRejectCommand'),
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
    if (rawArgs.includes('--json')) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(message);
    process.exit(1);
  }
}

main();
