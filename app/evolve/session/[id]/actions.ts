"use server";

import { getProcessStatusReport, readWorktreeLogLines, restartWorktreeServer } from "@/lib/process-manager";

export interface PreviewProcessSnapshot {
  status: 'starting' | 'running' | 'stopped' | 'unknown';
  logs: string;
}

export async function getPreviewProcessSnapshot(sessionId: string): Promise<PreviewProcessSnapshot> {
  try {
    const report = getProcessStatusReport(process.cwd());
    const worktree = report.worktrees.find((item) => item.branch === sessionId);
    const status = worktree ? (worktree.servers.length > 0 ? 'running' : 'stopped') : 'unknown';
    const logs = readWorktreeLogLines(sessionId, process.cwd()).join('\n');
    return { status, logs };
  } catch {
    return { status: 'unknown', logs: '' };
  }
}

export async function restartPreviewServer(sessionId: string): Promise<PreviewProcessSnapshot> {
  await restartWorktreeServer(sessionId, 'dev', process.cwd());
  const snapshot = await getPreviewProcessSnapshot(sessionId);
  return { ...snapshot, status: snapshot.status === 'unknown' ? 'unknown' : 'starting' };
}
