"use server";

import { getProcessStatusReport, restartWorktreeServer } from "@/lib/process-manager";

export interface PreviewProcessSnapshot {
  status: 'starting' | 'running' | 'stopped' | 'unknown';
}

export async function getPreviewProcessSnapshot(sessionId: string): Promise<PreviewProcessSnapshot> {
  try {
    const report = getProcessStatusReport(process.cwd());
    const worktree = report.worktrees.find((item) => item.branch === sessionId);
    const status = worktree ? (worktree.servers.length > 0 ? 'running' : 'stopped') : 'unknown';
    return { status };
  } catch {
    return { status: 'unknown' };
  }
}

export async function restartPreviewServer(sessionId: string): Promise<PreviewProcessSnapshot> {
  await restartWorktreeServer(sessionId, 'dev', process.cwd());
  const snapshot = await getPreviewProcessSnapshot(sessionId);
  return { ...snapshot, status: snapshot.status === 'unknown' ? 'unknown' : 'starting' };
}
