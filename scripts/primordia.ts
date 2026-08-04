#!/usr/bin/env bun

import {
  CliUsageError,
  runCli,
  type CliArgumentDef,
  type CliCommandDef,
  type CliOptionDef,
  type CliParsedArgs,
} from '@/lib/tiny-cli';
import { applyCurrentProcessOomRole } from '@/lib/oom-priority';

applyCurrentProcessOomRole('command', (message) => console.warn(`[primordia-cli] ${message}`));

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
  description: 'Print machine-formatted output instead of human-readable output. Log commands use NDJSON.',
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

const harnessOption: CliOptionDef = {
  name: 'harness',
  type: 'string',
  valueHint: 'harness',
  description: 'Preferred fallback harness for the thread form: claude-code, pi, or codex.',
  complete() {
    return ['claude-code', 'pi', 'codex'];
  },
};

const modelOption: CliOptionDef = {
  name: 'model',
  type: 'string',
  valueHint: 'model',
  description: 'Preferred fallback model id for the selected harness.',
  complete() {
    return importCommandHandlers().then((handlers) => handlers.completeModelIds());
  },
};

const cavemanOption: CliOptionDef = {
  name: 'caveman',
  type: 'string',
  valueHint: 'true|false',
  description: 'Whether caveman mode should be enabled by default in thread forms.',
  complete() {
    return ['true', 'false'];
  },
};

const cavemanIntensityOption: CliOptionDef = {
  name: 'caveman-intensity',
  type: 'string',
  valueHint: 'intensity',
  description: 'Default caveman intensity: lite, full, ultra, wenyan-lite, wenyan-full, or wenyan-ultra.',
  complete() {
    return ['lite', 'full', 'ultra', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra'];
  },
};

const followOption: CliOptionDef = {
  name: 'follow',
  alias: 'f',
  type: 'boolean',
  description: 'Keep streaming appended log lines.',
};

const linesOption: CliOptionDef = {
  name: 'lines',
  alias: 'n',
  type: 'string',
  valueHint: 'count',
  description: 'Number of recent log lines to print. With --start, this limits how many lines to print from the cursor.',
};

const startLineOption: CliOptionDef = {
  name: 'start',
  alias: 's',
  type: 'string',
  valueHint: 'line',
  description: 'Print log lines starting at 1-based line number N instead of tailing recent lines.',
};

const attachOption: CliOptionDef = {
  name: 'attach',
  alias: 'a',
  type: 'string',
  valueHint: 'file',
  description: 'Attach a file to the thread request. May be provided multiple times.',
  multiple: true,
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
  api: { path: '/status', method: 'GET' },
  run: lazyRun('statusCommand'),
};

const serverStatusCommand: CliCommandDef = {
  name: 'status',
  description: "Show the current thread's server status. With --follow --json, emit an NDJSON update whenever it changes.",
  options: [jsonOption, followOption],
  api: { path: '/server/[threadId]/status', method: 'GET', streaming: true, cwdParam: 'threadId' },
  run: lazyRun('serverStatusCommand'),
};

const startCommand: CliCommandDef = {
  name: 'start',
  description: "Start the thread's Next.js server.",
  options: [jsonOption, devOption, prodOption],
  api: { path: '/server/[threadId]/start', cwdParam: 'threadId' },
  run: lazyRun('serverStartCommand'),
};

const stopCommand: CliCommandDef = {
  name: 'stop',
  description: "Stop the thread's active server process(es).",
  options: [jsonOption],
  api: { path: '/server/[threadId]/stop', cwdParam: 'threadId' },
  run: lazyRun('serverStopCommand'),
};

const restartCommand: CliCommandDef = {
  name: 'restart',
  description: "Stop, then start, the thread's server.",
  options: [jsonOption, devOption, prodOption],
  api: { path: '/server/[threadId]/restart', cwdParam: 'threadId' },
  run: lazyRun('serverRestartCommand'),
};

const logsCommand: CliCommandDef = {
  name: 'logs',
  description: "Print the thread's server log file. With --json, emits NDJSON records wrapping each log line.",
  options: [jsonOption, linesOption, startLineOption, followOption],
  api: { path: '/server/[threadId]/logs', method: 'GET', streaming: true, cwdParam: 'threadId' },
  run: lazyRun('serverLogsCommand'),
};

const publishCommand: CliCommandDef = {
  name: 'publish',
  description: "Health-check the thread's server, then promote it to production.",
  options: [jsonOption],
  api: { path: '/server/[threadId]/publish', cwdParam: 'threadId' },
  run: lazyRun('serverPublishCommand'),
};

const copyDbCommand: CliCommandDef = {
  name: 'copydb',
  description: 'Safely copy the production SQLite DB into the thread.',
  options: [jsonOption],
  api: { path: '/server/[threadId]/copydb', cwdParam: 'threadId' },
  run: lazyRun('serverCopyDbCommand'),
};

const createCommand: CliCommandDef = {
  name: 'create',
  description: 'Create a thread and run its initial agent turn.',
  options: [jsonOption, userOption, presetOption, cavemanOption, cavemanIntensityOption, attachOption],
  arguments: [requestArgument],
  api: { path: '/thread', multipart: true },
  run: lazyRun('threadCreateCommand'),
};

const followupCommand: CliCommandDef = {
  name: 'followup',
  description: 'Run a follow-up request on the current thread.',
  options: [jsonOption, userOption, presetOption, attachOption],
  arguments: [requestArgument],
  api: { path: '/thread/[threadId]/followup', multipart: true, cwdParam: 'threadId' },
  run: lazyRun('threadFollowupCommand'),
};

const threadLogsCommand: CliCommandDef = {
  name: 'logs',
  description: "Print the thread's session log in a human-readable form. With --json, emits raw NDJSON events.",
  options: [jsonOption, linesOption, startLineOption, followOption],
  api: { path: '/thread/[threadId]/logs', method: 'GET', streaming: true, cwdParam: 'threadId' },
  run: lazyRun('threadLogsCommand'),
};

const updateCommand: CliCommandDef = {
  name: 'update',
  description: 'Apply parent/prod updates to the current thread.',
  options: [jsonOption, userOption],
  api: { path: '/thread/[threadId]/update', cwdParam: 'threadId' },
  run: lazyRun('threadUpdateCommand'),
};

const acceptCommand: CliCommandDef = {
  name: 'accept',
  description: 'Accept (deploy/merge) the current thread.',
  options: [jsonOption, userOption],
  api: { path: '/thread/[threadId]/accept', cwdParam: 'threadId' },
  run: lazyRun('threadAcceptCommand'),
};

const rejectCommand: CliCommandDef = {
  name: 'reject',
  description: 'Reject (discard) the current thread.',
  options: [jsonOption, userOption],
  api: { path: '/thread/[threadId]/reject', cwdParam: 'threadId' },
  run: lazyRun('threadRejectCommand'),
};

const jobsRunCommand: CliCommandDef = {
  name: 'run',
  description: 'Run the Primordia scheduled jobs daemon in this process.',
  options: [jsonOption],
  api: { path: '/jobs/run', streaming: true },
  run: lazyRun('jobsRunCommand'),
};

const jobsRunOneCommand: CliCommandDef = {
  name: 'run-one',
  description: 'Run one Primordia scheduled job immediately.',
  options: [jsonOption],
  arguments: [jobNameArgument],
  api: { path: '/jobs/run-one' },
  run: lazyRun('jobsRunOneCommand'),
};

const jobsScheduleListCommand: CliCommandDef = {
  name: 'list',
  description: 'List scheduled job intervals.',
  options: [jsonOption],
  api: { path: '/jobs/schedule', method: 'GET' },
  run: lazyRun('jobsScheduleListCommand'),
};

const jobsScheduleGetCommand: CliCommandDef = {
  name: 'get',
  description: 'Read one scheduled job interval.',
  options: [jsonOption],
  arguments: [jobNameArgument],
  api: { path: '/jobs/schedule/[job]', method: 'GET' },
  run: lazyRun('jobsScheduleGetCommand'),
};

const jobsScheduleSetCommand: CliCommandDef = {
  name: 'set',
  description: 'Set one scheduled job interval.',
  options: [jsonOption],
  arguments: [jobNameArgument, intervalArgument],
  api: { path: '/jobs/schedule/[job]/set' },
  run: lazyRun('jobsScheduleSetCommand'),
};

const jobsScheduleCommand: CliCommandDef = {
  name: 'schedule',
  description: 'Read or change scheduled job intervals.',
  subcommands: [jobsScheduleListCommand, jobsScheduleGetCommand, jobsScheduleSetCommand],
};

const jobsRestartCommand: CliCommandDef = {
  name: 'restart',
  description: 'Restart the supervised scheduled jobs daemon.',
  options: [jsonOption],
  api: { path: '/jobs/restart' },
  run: lazyRun('jobsRestartCommand'),
};

const jobsLogsCommand: CliCommandDef = {
  name: 'logs',
  description: 'Print the supervised scheduled jobs daemon log.',
  options: [jsonOption, linesOption, startLineOption, followOption],
  api: { path: '/jobs/logs', method: 'GET', streaming: true },
  run: lazyRun('jobsLogsCommand'),
};

const jobsCommand: CliCommandDef = {
  name: 'jobs',
  description: 'Run and configure Primordia Core scheduled jobs.',
  subcommands: [jobsRunCommand, jobsRunOneCommand, jobsRestartCommand, jobsLogsCommand, jobsScheduleCommand],
};

const reverseProxyRestartCommand: CliCommandDef = {
  name: 'restart',
  description: 'Restart the supervised reverse proxy service.',
  options: [jsonOption],
  api: { path: '/reverse-proxy/restart' },
  run: lazyRun('reverseProxyRestartCommand'),
};

const reverseProxyLogsCommand: CliCommandDef = {
  name: 'logs',
  description: 'Print the supervised reverse proxy service log.',
  options: [jsonOption, linesOption, startLineOption, followOption],
  api: { path: '/reverse-proxy/logs', method: 'GET', streaming: true },
  run: lazyRun('reverseProxyLogsCommand'),
};

const reverseProxyCommand: CliCommandDef = {
  name: 'reverse-proxy',
  description: 'Manage the supervised reverse proxy service.',
  subcommands: [reverseProxyRestartCommand, reverseProxyLogsCommand],
};

const serviceSupervisorRestartCommand: CliCommandDef = {
  name: 'restart',
  description: 'Restart only the Primordia service-supervisor systemd service.',
  options: [jsonOption],
  api: { path: '/systemd/service-supervisor/restart' },
  run: lazyRun('systemdServiceSupervisorRestartCommand'),
};

const serviceSupervisorCommand: CliCommandDef = {
  name: 'service-supervisor',
  description: 'Manage the systemd-supervised Primordia service supervisor.',
  subcommands: [serviceSupervisorRestartCommand],
};

const systemdCommand: CliCommandDef = {
  name: 'systemd',
  description: 'Manage Primordia systemd-backed processes.',
  subcommands: [serviceSupervisorCommand],
};

const preferencesGetCommand: CliCommandDef = {
  name: 'get',
  description: 'Show saved user preferences used by thread creation.',
  options: [jsonOption, userOption],
  api: { path: '/preferences', method: 'GET' },
  run: lazyRun('preferencesGetCommand'),
};

const preferencesSetCommand: CliCommandDef = {
  name: 'set',
  description: 'Set saved user preferences used by thread creation.',
  options: [jsonOption, userOption, presetOption, harnessOption, modelOption, cavemanOption, cavemanIntensityOption],
  api: { path: '/preferences/set' },
  run: lazyRun('preferencesSetCommand'),
};

const preferencesCommand: CliCommandDef = {
  name: 'preferences',
  description: 'Read and set per-user thread preferences.',
  subcommands: [preferencesGetCommand, preferencesSetCommand],
};

const threadCommand: CliCommandDef = {
  name: 'thread',
  description: 'Manage Primordia agentic coding threads.',
  subcommands: [createCommand, followupCommand, threadLogsCommand, updateCommand, acceptCommand, rejectCommand],
};

const serverCommand: CliCommandDef = {
  name: 'server',
  description: 'Manage the current thread server process.',
  subcommands: [serverStatusCommand, startCommand, stopCommand, restartCommand, logsCommand, publishCommand, copyDbCommand],
};

export const mainCommand: CliCommandDef = {
  name: 'primordia',
  description: 'Manage Primordia thread and server lifecycle tasks.',
  subcommands: [statusCommand, threadCommand, preferencesCommand, serverCommand, jobsCommand, reverseProxyCommand, systemdCommand],
};

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  try {
    await runCli(mainCommand, rawArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (rawArgs.includes('--json')) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(message);
    process.exit(err instanceof CliUsageError ? 64 : 1);
  }
}

if (import.meta.main) main();
