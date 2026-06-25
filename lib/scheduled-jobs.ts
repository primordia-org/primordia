import { getProxyRoutingState } from './process-manager';
import { runDiskCleanupOnce } from './disk-space-management';
import { startDependencyAuditScheduler } from './dependency-audit-scheduler';
import { startUpdateSourceScheduler } from './update-source-scheduler';

const DISK_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export interface ScheduledJobsOptions {
  repoRoot?: string;
  listenPort?: number;
  archiveRoot?: string;
  logError?: (label: string, err: unknown) => void;
}

let started = false;

function defaultLogError(label: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[scheduled-jobs] ${label}:`, message);
}

async function runDiskCleanupJob(options: ScheduledJobsOptions): Promise<void> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const config = getProxyRoutingState(repoRoot, options.listenPort);
  await runDiskCleanupOnce({
    repoRoot,
    listenPort: options.listenPort,
    archiveRoot: options.archiveRoot,
    thresholdPct: config.diskCleanupThresholdPct ?? 90,
  });
}

export function runScheduledJobs(options: ScheduledJobsOptions = {}): void {
  if (started) return;
  started = true;

  const repoRoot = options.repoRoot ?? process.cwd();
  startUpdateSourceScheduler(repoRoot);
  startDependencyAuditScheduler(repoRoot);

  const logError = options.logError ?? defaultLogError;
  setTimeout(() => {
    runDiskCleanupJob(options).catch((err) => logError('initial disk cleanup failed', err));
  }, 30_000).unref();

  setInterval(() => {
    runDiskCleanupJob(options).catch((err) => logError('periodic disk cleanup failed', err));
  }, DISK_CLEANUP_INTERVAL_MS).unref();
}
