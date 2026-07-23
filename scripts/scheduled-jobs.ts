// scripts/scheduled-jobs.ts
// Bundled entrypoint for the supervised Primordia scheduled jobs daemon.

import * as path from 'path';
import { getPrimordiaRuntimePaths, listGitWorktrees, runGit } from '@/lib/git-runtime';
import { runPrimordiaJobs } from '@/lib/scheduled-jobs';

function productionBranch(mainRepo: string): string | null {
  try {
    return runGit(['config', '--get', 'primordia.productionBranch'], mainRepo).trim() || null;
  } catch {
    return null;
  }
}

function productionWorktree(paths: ReturnType<typeof getPrimordiaRuntimePaths>): string {
  const branch = productionBranch(paths.mainRepo);
  if (!branch) return process.cwd();
  const match = listGitWorktrees(paths.mainRepo).find((worktree) => worktree.branch === branch);
  return match?.path ?? path.join(paths.worktreesDir, branch);
}

function logError(label: string, err: unknown): void {
  console.error(`[scheduled-jobs] ${label}:`, err instanceof Error ? err.message : String(err));
}

const paths = getPrimordiaRuntimePaths(process.argv[1]);
const listenPort = Number.parseInt(process.env.REVERSE_PROXY_PORT ?? '', 10);
const started = runPrimordiaJobs({
  repoRoot: productionWorktree(paths),
  listenPort: Number.isFinite(listenPort) ? listenPort : undefined,
  archiveRoot: process.env.PRIMORDIA_DIR || paths.root,
  logError,
});

if (!started) {
  console.warn('[scheduled-jobs] another scheduler already holds the jobs lock; exiting');
  process.exit(0);
}

console.log('[scheduled-jobs] daemon running');
await new Promise(() => { /* keep daemon alive */ });
