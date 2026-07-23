// scripts/process-supervisor.ts
// Small systemd-facing launcher for Primordia's long-lived core processes.
// systemd keeps this stub alive; the stub owns the reverse proxy and scheduled
// jobs daemon, restarting either child if it crashes. SIGHUP reloads both
// children; SIGUSR1 reloads only the reverse proxy; SIGUSR2 reloads only the
// scheduled jobs daemon.

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getPrimordiaRuntimePaths, listGitWorktrees, runGit } from '@/lib/git-runtime';

type ServiceName = 'reverse-proxy' | 'scheduled-jobs';

interface ManagedService {
  name: ServiceName;
  child: ChildProcess | null;
  stopping: boolean;
  restartTimer: NodeJS.Timeout | null;
  crashCount: number;
  startedAt: number;
  start: () => ChildProcess;
}

const paths = getPrimordiaRuntimePaths(process.argv[1]);
const miseBin = process.env.PRIMORDIA_MISE_BIN || process.env.MISE_BIN || 'mise';
const trustedConfigPaths = process.env.MISE_TRUSTED_CONFIG_PATHS || `${paths.root}:${paths.worktreesDir}`;
let shuttingDown = false;

function log(message: string): void {
  console.log(`[supervisor] ${message}`);
}

function logError(message: string, err: unknown): void {
  console.error(`[supervisor] ${message}:`, err instanceof Error ? err.message : String(err));
}

function productionBranch(): string | null {
  try {
    return runGit(['config', '--get', 'primordia.productionBranch'], paths.mainRepo).trim() || null;
  } catch {
    return null;
  }
}

function productionWorktree(): string {
  const branch = productionBranch();
  if (!branch) return process.cwd();
  const match = listGitWorktrees(paths.mainRepo).find((worktree) => worktree.branch === branch);
  if (match) return match.path;

  const conventionalPath = path.join(paths.worktreesDir, branch);
  if (fs.existsSync(conventionalPath)) return conventionalPath;
  throw new Error(`production branch ${branch} does not have a checked-out worktree`);
}

function spawnViaMise(cwd: string, args: string[], extraEnv: Record<string, string> = {}): ChildProcess {
  return spawn(miseBin, ['exec', '-C', cwd, '--', ...args], {
    cwd,
    env: {
      ...process.env,
      PRIMORDIA_DIR: paths.root,
      MISE_TRUSTED_CONFIG_PATHS: trustedConfigPaths,
      ...extraEnv,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function startReverseProxy(): ChildProcess {
  const entrypoint = path.join(paths.root, 'reverse-proxy.js');
  return spawnViaMise(paths.root, ['bun', entrypoint]);
}

function startScheduledJobs(): ChildProcess {
  const cwd = productionWorktree();
  return spawnViaMise(cwd, ['bun', 'run', 'primordia', 'jobs', 'run'], {
    PRIMORDIA_SUPERVISED_SERVICE: 'scheduled-jobs',
  });
}

const services: ManagedService[] = [
  { name: 'reverse-proxy', child: null, stopping: false, restartTimer: null, crashCount: 0, startedAt: 0, start: startReverseProxy },
  { name: 'scheduled-jobs', child: null, stopping: false, restartTimer: null, crashCount: 0, startedAt: 0, start: startScheduledJobs },
];

function scheduleStart(service: ManagedService, reason: string): void {
  if (shuttingDown || service.restartTimer) return;
  const backoffMs = Math.min(30_000, 1_000 * 2 ** Math.min(service.crashCount, 5));
  log(`${service.name} ${reason}; restarting in ${backoffMs}ms`);
  service.restartTimer = setTimeout(() => {
    service.restartTimer = null;
    startService(service);
  }, backoffMs);
}

function startService(service: ManagedService): void {
  if (shuttingDown || service.child) return;
  try {
    const child = service.start();
    service.child = child;
    service.stopping = false;
    service.startedAt = Date.now();
    log(`started ${service.name} pid ${child.pid ?? 'unknown'}`);

    child.on('exit', (code, signal) => {
      service.child = null;
      const uptimeMs = Date.now() - service.startedAt;
      service.crashCount = uptimeMs > 60_000 ? 0 : service.crashCount + 1;
      if (shuttingDown || service.stopping) {
        log(`${service.name} stopped (${signal ?? code ?? 'exit'})`);
        service.stopping = false;
        return;
      }
      scheduleStart(service, `exited unexpectedly (${signal ?? code ?? 'exit'})`);
    });

    child.on('error', (err) => {
      service.child = null;
      service.crashCount += 1;
      logError(`${service.name} spawn failed`, err);
      scheduleStart(service, 'failed to start');
    });
  } catch (err) {
    service.crashCount += 1;
    logError(`${service.name} start failed`, err);
    scheduleStart(service, 'failed to start');
  }
}

function stopService(service: ManagedService): void {
  if (service.restartTimer) {
    clearTimeout(service.restartTimer);
    service.restartTimer = null;
  }
  const child = service.child;
  if (!child) return;
  service.stopping = true;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (service.child === child) child.kill('SIGKILL');
  }, 10_000).unref();
}

function reloadService(service: ManagedService, signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  log(`received ${signal}; reloading ${service.name}`);
  const child = service.child;
  stopService(service);
  if (!child) startService(service);
  else child.once('exit', () => startService(service));
}

function findService(name: ServiceName): ManagedService {
  const service = services.find((entry) => entry.name === name);
  if (!service) throw new Error(`unknown supervised service: ${name}`);
  return service;
}

function reloadChildren(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  log(`received ${signal}; reloading all children`);
  for (const service of services) reloadService(service, signal);
}

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`received ${signal}; shutting down`);
  for (const service of services) stopService(service);
  setTimeout(() => process.exit(0), 12_000).unref();
}

process.on('SIGHUP', reloadChildren);
process.on('SIGUSR1', (signal) => reloadService(findService('reverse-proxy'), signal));
process.on('SIGUSR2', (signal) => reloadService(findService('scheduled-jobs'), signal));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => logError('uncaught exception', err));
process.on('unhandledRejection', (err) => logError('unhandled rejection', err));

log(`root: ${paths.root}`);
for (const service of services) startService(service);
