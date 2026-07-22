import type { PrimordiaJobContext } from './primordia-jobs';
import { runPrimordiaJobs } from './primordia-jobs';

export type ScheduledJobsOptions = PrimordiaJobContext;

export function runScheduledJobs(options: ScheduledJobsOptions = { repoRoot: process.cwd() }): boolean {
  return runPrimordiaJobs(options);
}
