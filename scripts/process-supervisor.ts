// scripts/process-supervisor.ts
// Small systemd-facing monitor for Primordia's long-lived core processes.
// systemd keeps this stub alive; the stub keeps the reverse proxy and scheduled
// jobs daemon alive as independent detached processes. The installer sets the
// systemd unit to KillMode=process so restarting the supervisor itself does not
// stop or restart either supervised Primordia service.
// SIGHUP checks both services, SIGUSR1 restarts only reverse-proxy, and SIGUSR2
// restarts only scheduled-jobs.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getPrimordiaRuntimePaths } from '@/lib/git-runtime';

type ServiceName = 'reverse-proxy' | 'scheduled-jobs';

interface ManagedService {
  name: ServiceName;
  scriptName: string;
  signal: NodeJS.Signals;
  pidFile: string;
  restartTimer: NodeJS.Timeout | null;
  crashCount: number;
}

const paths = getPrimordiaRuntimePaths(process.argv[1]);
const trustedConfigPaths = process.env.MISE_TRUSTED_CONFIG_PATHS || `${paths.root}:${paths.worktreesDir}`;
let shuttingDown = false;

const services: ManagedService[] = [
  {
    name: 'reverse-proxy',
    scriptName: 'reverse-proxy.js',
    signal: 'SIGUSR1',
    pidFile: path.join(paths.root, '.primordia-reverse-proxy.pid'),
    restartTimer: null,
    crashCount: 0,
  },
  {
    name: 'scheduled-jobs',
    scriptName: 'scheduled-jobs.js',
    signal: 'SIGUSR2',
    pidFile: path.join(paths.root, '.primordia-scheduled-jobs.pid'),
    restartTimer: null,
    crashCount: 0,
  },
];

function log(message: string): void {
  console.log(`[supervisor] ${message}`);
}

function logError(message: string, err: unknown): void {
  console.error(`[supervisor] ${message}:`, err instanceof Error ? err.message : String(err));
}

function readPid(pidFile: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePid(pidFile: string, pid: number): void {
  fs.writeFileSync(pidFile, `${pid}\n`, 'utf8');
}

function isAlive(pid: number | null): pid is number {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function servicePid(service: ManagedService): number | null {
  const pid = readPid(service.pidFile);
  if (isAlive(pid)) return pid;
  if (pid) fs.rmSync(service.pidFile, { force: true });
  return null;
}

function spawnService(service: ManagedService): void {
  const existingPid = servicePid(service);
  if (existingPid) return;

  const scriptPath = path.join(paths.root, service.scriptName);
  const child = spawn('bun', [scriptPath], {
    cwd: paths.root,
    detached: true,
    env: {
      ...process.env,
      PRIMORDIA_DIR: paths.root,
      MISE_TRUSTED_CONFIG_PATHS: trustedConfigPaths,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  if (!child.pid) throw new Error(`failed to spawn ${service.name}`);
  writePid(service.pidFile, child.pid);
  child.unref();
  service.crashCount = 0;
  log(`started ${service.name} pid ${child.pid}`);
}

function ensureService(service: ManagedService): void {
  if (shuttingDown) return;
  try {
    if (servicePid(service)) return;
    spawnService(service);
  } catch (err) {
    service.crashCount += 1;
    logError(`${service.name} start failed`, err);
    scheduleEnsure(service, 'start failed');
  }
}

function scheduleEnsure(service: ManagedService, reason: string): void {
  if (shuttingDown || service.restartTimer) return;
  const backoffMs = Math.min(30_000, 1_000 * 2 ** Math.min(service.crashCount, 5));
  log(`${service.name} ${reason}; checking again in ${backoffMs}ms`);
  service.restartTimer = setTimeout(() => {
    service.restartTimer = null;
    ensureService(service);
  }, backoffMs);
}

function stopService(service: ManagedService): void {
  const pid = servicePid(service);
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }
  fs.rmSync(service.pidFile, { force: true });
  setTimeout(() => {
    if (!isAlive(pid)) return;
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      process.kill(pid, 'SIGKILL');
    }
  }, 10_000).unref();
}

function restartService(service: ManagedService, signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  log(`received ${signal}; restarting ${service.name}`);
  stopService(service);
  setTimeout(() => ensureService(service), 500).unref();
}

function findService(name: ServiceName): ManagedService {
  const service = services.find((entry) => entry.name === name);
  if (!service) throw new Error(`unknown supervised service: ${name}`);
  return service;
}

function checkServices(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  log(`received ${signal}; checking services`);
  for (const service of services) ensureService(service);
}

function shutdown(signal: NodeJS.Signals): void {
  shuttingDown = true;
  log(`received ${signal}; supervisor exiting without stopping services`);
  process.exit(0);
}

process.on('SIGHUP', checkServices);
process.on('SIGUSR1', (signal) => restartService(findService('reverse-proxy'), signal));
process.on('SIGUSR2', (signal) => restartService(findService('scheduled-jobs'), signal));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => logError('uncaught exception', err));
process.on('unhandledRejection', (err) => logError('unhandled rejection', err));

log(`root: ${paths.root}`);
for (const service of services) ensureService(service);
setInterval(() => {
  for (const service of services) ensureService(service);
}, 5_000).unref();
await new Promise(() => { /* keep supervisor alive */ });
