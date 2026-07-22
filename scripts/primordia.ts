#!/usr/bin/env bun

import {
  runCli,
  type CliArgumentDef,
  type CliCommandDef,
  type CliOptionDef,
  type CliParsedArgs,
} from '@/lib/tiny-cli';
const COMMAND_HANDLERS_MODULE = './primordia-command-handlers';
const PRESET_HELPERS_MODULE = './primordia-preset-helpers';

function importCommandHandlers(): Promise<typeof import('./primordia-command-handlers')> {
  return import(COMMAND_HANDLERS_MODULE);
}

function importPresetHelpers(): Promise<typeof import('./primordia-preset-helpers')> {
  return import(PRESET_HELPERS_MODULE);
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

const BUILT_IN_CLI_PRESET_IDS = [
  'claude-code-gateway',
  'claude-code-subscription',
  'claude-code-api-key',
  'codex-gateway',
  'codex-chatgpt',
  'codex-openai-api-key',
  'pi-chatgpt-codex-mini',
  'pi-openrouter-sonnet',
  'pi-openrouter-gemini-flash',
  'pi-gemini-flash',
  'free-option',
];

const presetOption: CliOptionDef = {
  name: 'preset',
  type: 'string',
  valueHint: 'preset',
  description: "Preset id. Built-in presets omit the 'builtin:' prefix. Defaults to the user's saved preset when available.",
  complete(context) {
    return importPresetHelpers()
      .then((helpers) => helpers.completeCliPresetIds(context))
      .catch(() => BUILT_IN_CLI_PRESET_IDS);
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

const jobNameArgument: CliArgumentDef = {
  name: 'job',
  required: true,
  valueHint: 'job',
  description: 'Job name: update-sources, dependency-audit, leak-diagnostics, or disk-cleanup.',
  complete() {
    return importCommandHandlers().then((handlers) => handlers.completeJobNames());
  },
};

const intervalArgument: CliArgumentDef = {
  name: 'interval',
  required: true,
  valueHint: 'interval',
  description: 'Interval such as 60000, 60s, 5m, 1h, or 1d.',
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

const jobsRunCommand: CliCommandDef = {
  name: 'run',
  description: 'Run the Primordia scheduled jobs daemon in this process.',
  options: [jsonOption],
  run: lazyRun('jobsRunCommand'),
};

const jobsRunOneCommand: CliCommandDef = {
  name: 'run-one',
  description: 'Run one Primordia scheduled job immediately.',
  options: [jsonOption],
  arguments: [jobNameArgument],
  run: lazyRun('jobsRunOneCommand'),
};

const jobsScheduleListCommand: CliCommandDef = {
  name: 'list',
  description: 'List scheduled job intervals.',
  options: [jsonOption],
  run: lazyRun('jobsScheduleListCommand'),
};

const jobsScheduleGetCommand: CliCommandDef = {
  name: 'get',
  description: 'Read one scheduled job interval.',
  options: [jsonOption],
  arguments: [jobNameArgument],
  run: lazyRun('jobsScheduleGetCommand'),
};

const jobsScheduleSetCommand: CliCommandDef = {
  name: 'set',
  description: 'Set one scheduled job interval.',
  options: [jsonOption],
  arguments: [jobNameArgument, intervalArgument],
  run: lazyRun('jobsScheduleSetCommand'),
};

const jobsScheduleCommand: CliCommandDef = {
  name: 'schedule',
  description: 'Read or change scheduled job intervals.',
  subcommands: [jobsScheduleListCommand, jobsScheduleGetCommand, jobsScheduleSetCommand],
};

const jobsCommand: CliCommandDef = {
  name: 'jobs',
  description: 'Run and configure Primordia Core scheduled jobs.',
  subcommands: [jobsRunCommand, jobsRunOneCommand, jobsScheduleCommand],
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
  subcommands: [statusCommand, threadCommand, serverCommand, jobsCommand],
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
