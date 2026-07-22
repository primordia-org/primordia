import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { gzipSync } from 'zlib';
import { deleteWorktreeAndBranch, getProxyRoutingState, stopWorktreeServer } from '@/lib/process-manager';

export interface CleanupWorktreeTarget {
  path: string;
  branch: string;
}

export interface DiskCleanupOptions {
  repoRoot?: string;
  listenPort?: number;
  archiveRoot?: string;
  thresholdPct?: number;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export interface DiskCleanupSchedulerOptions {
  repoRoot?: string;
  listenPort?: number;
  archiveRoot?: string;
  intervalMs?: number;
  logError?: (label: string, err: unknown) => void;
}

const DISK_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let diskCleanupSchedulerStarted = false;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeArchiveFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
}

function archiveSessionNdjsonLogBeforeCleanup(worktreePath: string, sessionId: string, archiveRoot: string): void {
  const ndjsonPath = path.join(worktreePath, '.primordia-session.ndjson');
  if (!fs.existsSync(ndjsonPath)) return;

  const content = fs.readFileSync(ndjsonPath);
  if (content.length === 0) return;

  const archiveDir = path.join(archiveRoot, 'past-sessions');
  fs.mkdirSync(archiveDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeSessionId = safeArchiveFilenamePart(sessionId || path.basename(worktreePath));
  const baseName = `${timestamp}-${safeSessionId}.ndjson.gz`;
  let archivePath = path.join(archiveDir, baseName);
  for (let i = 2; fs.existsSync(archivePath); i++) {
    archivePath = path.join(archiveDir, `${timestamp}-${safeSessionId}-${i}.ndjson.gz`);
  }

  fs.writeFileSync(archivePath, gzipSync(content));
}

export function getDiskUsedPercent(mountPoint = '/'): number | null {
  try {
    const out = execFileSync('df', ['-B1', mountPoint], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const dataLine = out.trim().split('\n').slice(1).join(' ').trim();
    const parts = dataLine.split(/\s+/);
    if (parts.length < 3) return null;
    const total = Number.parseInt(parts[1], 10);
    const used = Number.parseInt(parts[2], 10);
    if (!Number.isFinite(total) || !Number.isFinite(used) || total === 0) return null;
    return Math.round((used / total) * 100);
  } catch {
    return null;
  }
}

export function getOldestDeletableWorktree(repoRoot: string, listenPort?: number): CleanupWorktreeTarget | null {
  const state = getProxyRoutingState(repoRoot, listenPort);
  const candidates: (CleanupWorktreeTarget & { ctimeMs: number })[] = [];
  for (const [branch, target] of Object.entries(state.previewTargets)) {
    if (branch === state.productionBranch) continue;
    let ctimeMs = 0;
    try { ctimeMs = fs.statSync(target.worktreePath).ctimeMs; } catch { /* missing dir */ }
    candidates.push({ path: target.worktreePath, branch, ctimeMs });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.ctimeMs - b.ctimeMs);
  return { path: candidates[0].path, branch: candidates[0].branch };
}

export async function deleteWorktreeForCleanup(
  repoRoot: string,
  target: CleanupWorktreeTarget,
  options: { archiveRoot?: string; warn?: (message: string) => void } = {},
): Promise<void> {
  try {
    await stopWorktreeServer(target.branch, repoRoot);
  } catch { /* server may already be stopped */ }

  try {
    archiveSessionNdjsonLogBeforeCleanup(target.path, target.branch, options.archiveRoot ?? process.env.PRIMORDIA_DIR ?? repoRoot);
  } catch (err) {
    options.warn?.(`[disk-cleanup] failed to archive session log for ${target.branch}: ${errorMessage(err)}`);
  }

  deleteWorktreeAndBranch(target.path, target.branch, repoRoot);
}

export async function runDiskCleanupOnce(options: DiskCleanupOptions = {}): Promise<void> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const thresholdPct = options.thresholdPct ?? getProxyRoutingState(repoRoot, options.listenPort).diskCleanupThresholdPct ?? 90;
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.warn;
  const usedPct = getDiskUsedPercent();
  if (usedPct === null || usedPct < thresholdPct) return;

  log(`[disk-cleanup] disk at ${usedPct}% ≥ threshold ${thresholdPct}% — starting cleanup`);

  let deleted = 0;
  for (;;) {
    const current = getDiskUsedPercent();
    if (current === null || current < thresholdPct) break;

    const target = getOldestDeletableWorktree(repoRoot, options.listenPort);
    if (!target) {
      warn(`[disk-cleanup] no deletable non-prod worktrees remain; disk still at ${current}%`);
      break;
    }

    log(`[disk-cleanup] deleting worktree branch='${target.branch}' path='${target.path}' (disk ${current}%)`);
    await deleteWorktreeForCleanup(repoRoot, target, { archiveRoot: options.archiveRoot, warn });
    deleted++;
  }

  const finalPct = getDiskUsedPercent();
  log(`[disk-cleanup] done — deleted ${deleted} worktree(s), disk now at ${finalPct ?? '?'}%`);
}

function defaultLogError(label: string, err: unknown): void {
  console.error(`[disk-cleanup] ${label}:`, errorMessage(err));
}

function runDiskCleanupJob(options: DiskCleanupSchedulerOptions): void {
  runDiskCleanupOnce({
    repoRoot: options.repoRoot,
    listenPort: options.listenPort,
    archiveRoot: options.archiveRoot,
  }).catch((err) => (options.logError ?? defaultLogError)('disk cleanup failed', err));
}

export function startDiskCleanupJobScheduler(options: DiskCleanupSchedulerOptions = {}): void {
  if (diskCleanupSchedulerStarted) return;
  diskCleanupSchedulerStarted = true;

  const initialTimeout = setTimeout(() => runDiskCleanupJob(options), 30_000);
  if (typeof initialTimeout === 'object' && initialTimeout && 'unref' in initialTimeout) {
    initialTimeout.unref();
  }

  const intervalMs = options.intervalMs ?? DISK_CLEANUP_INTERVAL_MS;
  const intervalId = setInterval(() => runDiskCleanupJob(options), intervalMs);
  if (typeof intervalId === 'object' && intervalId && 'unref' in intervalId) {
    intervalId.unref();
  }

  console.log(`[disk-cleanup-scheduler] Started (check interval: ${intervalMs / 1000}s)`);
}
