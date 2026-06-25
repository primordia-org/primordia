import { startDiskCleanupJobScheduler } from './disk-space-management';
import { startDependencyAuditScheduler } from './dependency-audit-scheduler';
import { startUpdateSourceScheduler } from './update-source-scheduler';

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

export function runScheduledJobs(options: ScheduledJobsOptions = {}): void {
  if (started) return;
  started = true;

  const repoRoot = options.repoRoot ?? process.cwd();
  startUpdateSourceScheduler(repoRoot);
  startDependencyAuditScheduler(repoRoot);
  startDiskCleanupJobScheduler({
    repoRoot,
    listenPort: options.listenPort,
    archiveRoot: options.archiveRoot,
    logError: options.logError ?? defaultLogError,
  });
}
