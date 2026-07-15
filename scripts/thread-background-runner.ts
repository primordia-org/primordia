#!/usr/bin/env bun

// Detached helper used by the Primordia CLI so `primordia create` and
// `primordia followup` can return immediately while setup/agent work continues.

import * as fs from 'fs';
import { followupThread, startLocalEvolve, type LocalSession } from '@/lib/threads';

interface CreateRunnerConfig {
  kind: 'create';
  session: Omit<LocalSession, 'aesKey'>;
  requestText: string;
  repoRoot: string;
  savedAttachmentPaths: string[];
}

interface FollowupRunnerConfig {
  kind: 'followup';
  userId: string;
  threadId: string;
  requestText: string;
  presetId?: string | null;
  repoRoot: string;
  attachmentPaths: string[];
}

type RunnerConfig = CreateRunnerConfig | FollowupRunnerConfig;

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) throw new Error('config path required');

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as RunnerConfig;
  try {
    fs.rmSync(configPath, { force: true });
  } catch { /* best-effort */ }

  const primordiaAesKey = process.env.PRIMORDIA_AES_KEY ?? null;

  if (config.kind === 'create') {
    await startLocalEvolve(
      { ...config.session, aesKey: primordiaAesKey ?? undefined },
      config.requestText,
      config.repoRoot,
      undefined,
      config.savedAttachmentPaths,
      {
        worktreeAlreadyCreated: true,
        initialEventAlreadyWritten: true,
      },
    );
    return;
  }

  const result = await followupThread({
    userId: config.userId,
    threadId: config.threadId,
    requestText: config.requestText,
    presetId: config.presetId,
    primordiaAesKey,
    attachmentPaths: config.attachmentPaths,
    runInBackground: false,
  });

  if (!result.ok) throw new Error(result.error);
}

main().catch((err) => {
  console.error(`[thread-background-runner] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
