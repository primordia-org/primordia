"use server";

import { restartWorktreeServer } from "@/lib/process-manager";

export interface PreviewProcessSnapshot {
  status: 'starting' | 'running' | 'stopped' | 'unknown';
}

export async function restartPreviewServer(sessionId: string): Promise<PreviewProcessSnapshot> {
  await restartWorktreeServer(sessionId, 'dev', process.cwd());
  return { status: 'starting' };
}
