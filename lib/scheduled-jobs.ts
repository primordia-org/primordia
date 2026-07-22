import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';
import { startDiskCleanupJobScheduler, runDiskCleanupOnce } from './jobs/disk-space-management';
import { startDependencyAuditScheduler, runDependencyAuditJobOnce } from './jobs/dependency-audit-scheduler';
import { startLeakDiagnosticsScheduler, runLeakDiagnosticsJobOnce } from './jobs/leak-diagnostics-scheduler';
import { startUpdateSourceScheduler, runUpdateSourcesJobOnce } from './jobs/update-source-scheduler';

export type PrimordiaJobName = 'update-sources' | 'dependency-audit' | 'leak-diagnostics' | 'disk-cleanup';

export interface PrimordiaJobContext {
  repoRoot: string;
  listenPort?: number;
  archiveRoot?: string;
  logError?: (label: string, err: unknown) => void;
}

export interface PrimordiaJobSchedule {
  name: PrimordiaJobName;
  intervalMs: number;
  defaultIntervalMs: number;
  gitConfigKey: string;
}

export interface PrimordiaJobRunResult {
  ok: boolean;
  name: PrimordiaJobName;
  startedAt: number;
  finishedAt: number;
  summary: string;
}

export const PRIMORDIA_JOBS: Array<{ name: PrimordiaJobName; defaultIntervalMs: number; gitConfigKey: string }> = [
  { name: 'update-sources', defaultIntervalMs: 5 * 60 * 1000, gitConfigKey: 'primordia.jobs.updateSourcesIntervalMs' },
  { name: 'dependency-audit', defaultIntervalMs: 5 * 60 * 1000, gitConfigKey: 'primordia.jobs.dependencyAuditIntervalMs' },
  { name: 'leak-diagnostics', defaultIntervalMs: 60 * 1000, gitConfigKey: 'primordia.jobs.leakDiagnosticsIntervalMs' },
  { name: 'disk-cleanup', defaultIntervalMs: 5 * 60 * 1000, gitConfigKey: 'primordia.jobs.diskCleanupIntervalMs' },
];

let started = false;
let lockPath: string | null = null;

function defaultLogError(label: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[scheduled-jobs] ${label}:`, message);
}

function jobDef(name: PrimordiaJobName) {
  const def = PRIMORDIA_JOBS.find((job) => job.name === name);
  if (!def) throw new Error(`Unknown Primordia job: ${name}`);
  return def;
}

function gitGet(repoRoot: string, key: string): string | null {
  try {
    return execFileSync('git', ['config', '--get', key], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function gitSet(repoRoot: string, key: string, value: string): void {
  execFileSync('git', ['config', key, value], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe'] });
}

function normalizeIntervalMs(value: number): number {
  if (!Number.isInteger(value) || value < 1_000 || value > 30 * 24 * 60 * 60 * 1000) {
    throw new Error('interval must be an integer between 1000ms and 30 days');
  }
  return value;
}

export function parseJobInterval(value: string): number {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) throw new Error(`Invalid interval '${value}'. Use milliseconds or suffix ms/s/m/h/d.`);
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] ?? 'ms';
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return normalizeIntervalMs(amount * multiplier);
}

export function formatJobInterval(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

export function listJobSchedules(repoRoot = process.cwd()): PrimordiaJobSchedule[] {
  return PRIMORDIA_JOBS.map((def) => {
    const configured = Number.parseInt(gitGet(repoRoot, def.gitConfigKey) ?? '', 10);
    const intervalMs = Number.isFinite(configured) ? normalizeIntervalMs(configured) : def.defaultIntervalMs;
    return { ...def, intervalMs };
  });
}

export function getJobSchedule(name: PrimordiaJobName, repoRoot = process.cwd()): PrimordiaJobSchedule {
  return listJobSchedules(repoRoot).find((schedule) => schedule.name === name) ?? (() => { throw new Error(`Unknown Primordia job: ${name}`); })();
}

export function setJobScheduleInterval(name: PrimordiaJobName, intervalMs: number, repoRoot = process.cwd()): PrimordiaJobSchedule {
  const def = jobDef(name);
  gitSet(repoRoot, def.gitConfigKey, String(normalizeIntervalMs(intervalMs)));
  return getJobSchedule(name, repoRoot);
}

export function isPrimordiaJobName(value: string): value is PrimordiaJobName {
  return PRIMORDIA_JOBS.some((job) => job.name === value);
}

function runtimeRoot(repoRoot: string, archiveRoot?: string): string {
  return archiveRoot ?? process.env.PRIMORDIA_DIR ?? repoRoot;
}

function acquireSchedulerLock(repoRoot: string, archiveRoot?: string): boolean {
  const root = runtimeRoot(repoRoot, archiveRoot);
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, '.primordia-jobs.lock');
  try {
    const fd = fs.openSync(target, 'wx');
    fs.writeFileSync(fd, `${process.pid}\n`);
    fs.closeSync(fd);
    lockPath = target;
    return true;
  } catch {
    try {
      const pid = Number.parseInt(fs.readFileSync(target, 'utf8').trim(), 10);
      if (Number.isFinite(pid)) process.kill(pid, 0);
      return false;
    } catch {
      try { fs.rmSync(target, { force: true }); } catch { /* ignore */ }
      return acquireSchedulerLock(repoRoot, archiveRoot);
    }
  }
}

function releaseSchedulerLock(): void {
  if (!lockPath) return;
  try {
    const pid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    if (pid === process.pid) fs.rmSync(lockPath, { force: true });
  } catch { /* ignore */ }
  lockPath = null;
}

function registerLockCleanup(): void {
  // Do not install SIGINT/SIGTERM handlers here: the reverse proxy also uses
  // this embedded scheduler and owns its graceful shutdown behavior. If a
  // process dies before the exit hook runs, the next scheduler start treats the
  // stale PID lock as recoverable.
  process.once('exit', releaseSchedulerLock);
}

export async function runPrimordiaJobOnce(name: PrimordiaJobName, context: PrimordiaJobContext): Promise<PrimordiaJobRunResult> {
  const startedAt = Date.now();
  try {
    if (name === 'update-sources') runUpdateSourcesJobOnce(context.repoRoot, { force: true });
    else if (name === 'dependency-audit') runDependencyAuditJobOnce(context.repoRoot, { force: true });
    else if (name === 'leak-diagnostics') runLeakDiagnosticsJobOnce(context.repoRoot);
    else if (name === 'disk-cleanup') await runDiskCleanupOnce({ repoRoot: context.repoRoot, listenPort: context.listenPort, archiveRoot: context.archiveRoot });
    else throw new Error(`Unknown Primordia job: ${name}`);
    return { ok: true, name, startedAt, finishedAt: Date.now(), summary: `${name} completed` };
  } catch (err) {
    context.logError?.(name, err);
    return { ok: false, name, startedAt, finishedAt: Date.now(), summary: err instanceof Error ? err.message : String(err) };
  }
}

export function runPrimordiaJobs(context: PrimordiaJobContext): boolean {
  if (started) return true;
  started = true;

  const repoRoot = context.repoRoot;
  if (!acquireSchedulerLock(repoRoot, context.archiveRoot)) {
    console.warn('[scheduled-jobs] another scheduler already holds the jobs lock; skipping embedded scheduler');
    return false;
  }
  registerLockCleanup();

  const schedules = Object.fromEntries(listJobSchedules(repoRoot).map((schedule) => [schedule.name, schedule.intervalMs])) as Record<PrimordiaJobName, number>;
  startUpdateSourceScheduler(repoRoot, { intervalMs: schedules['update-sources'] });
  startDependencyAuditScheduler(repoRoot, { intervalMs: schedules['dependency-audit'] });
  startLeakDiagnosticsScheduler(repoRoot, { captureIntervalMs: schedules['leak-diagnostics'] });
  startDiskCleanupJobScheduler({
    repoRoot,
    listenPort: context.listenPort,
    archiveRoot: context.archiveRoot,
    intervalMs: schedules['disk-cleanup'],
    logError: context.logError ?? defaultLogError,
  });
  return true;
}

export function spawnPrimordiaJobsDaemon(context: PrimordiaJobContext): void {
  const child = spawn(process.execPath, ['scripts/primordia.ts', 'jobs', 'run'], {
    cwd: context.repoRoot,
    env: { ...process.env, PRIMORDIA_DIR: runtimeRoot(context.repoRoot, context.archiveRoot) },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  child.unref();
}

export type ScheduledJobsOptions = PrimordiaJobContext;

export function runScheduledJobs(options: ScheduledJobsOptions = { repoRoot: process.cwd() }): boolean {
  return runPrimordiaJobs(options);
}
