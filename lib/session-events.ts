// lib/session-events.ts
// Structured event types for session progress logs.
// Events are stored as NDJSON (one JSON object per line) in
// {worktreePath}/.primordia-session.ndjson

import * as fs from 'fs';
import * as path from 'path';
import type { EvolveSession } from './db/types';

export type SessionEvent =
  | { type: 'section_start'; sectionType: 'setup' | 'claude' | 'type_fix' | 'followup' | 'deploy'; label: string; ts: number }
  | { type: 'setup_step'; label: string; done: boolean; ts: number }
  | { type: 'text'; content: string; ts: number }
  | { type: 'tool_use'; name: string; input: Record<string, unknown>; ts: number }
  | { type: 'result'; subtype: 'success' | 'error' | 'timeout' | 'aborted'; message?: string; ts: number }
  | { type: 'metrics'; durationMs: number | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; ts: number }
  | { type: 'log_line'; content: string; ts: number }
  | { type: 'initial_request'; request: string; attachments?: string[]; ts: number }
  | { type: 'followup_request'; request: string; attachments?: string[]; ts: number }
  | { type: 'decision'; action: 'accepted' | 'rejected'; detail: string; ts: number }
  | { type: 'legacy_text'; content: string };

export function getSessionNdjsonPath(worktreePath: string): string {
  return path.join(worktreePath, '.primordia-session.ndjson');
}

export function appendSessionEvent(ndjsonPath: string, event: SessionEvent): void {
  fs.appendFileSync(ndjsonPath, JSON.stringify(event) + '\n', 'utf8');
}

export function readSessionEvents(
  ndjsonPath: string,
  fromLine = 0,
): { events: SessionEvent[]; totalLines: number } {
  try {
    const content = fs.readFileSync(ndjsonPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const events: SessionEvent[] = [];
    for (let i = fromLine; i < lines.length; i++) {
      try {
        events.push(JSON.parse(lines[i]) as SessionEvent);
      } catch { /* skip malformed lines */ }
    }
    return { events, totalLines: lines.length };
  } catch {
    return { events: [], totalLines: 0 };
  }
}

/**
 * Returns the candidate worktree path for a session that isn't in the database.
 * Uses the sibling-directory convention of the flat worktree layout:
 * all worktrees live alongside the current one under the same parent directory.
 */
export function getCandidateWorktreePath(sessionId: string): string {
  return path.join(path.dirname(process.cwd()), sessionId);
}

/**
 * Attempts to reconstruct an EvolveSession record from the NDJSON log alone.
 * Useful when the session exists in a sibling worktree but not in the local DB
 * (e.g. the DB was copied before this session was created in a parent worktree).
 * Returns null if no log file exists or it contains no parseable events.
 */
export function deriveSessionFromLog(
  id: string,
  worktreePath: string,
): EvolveSession | null {
  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  if (!fs.existsSync(ndjsonPath)) return null;

  const { events } = readSessionEvents(ndjsonPath);
  if (events.length === 0) return null;

  let request = '';
  let createdAt = 0;
  let durationMs: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let costUsd: number | null = null;
  let status = 'ready';

  for (const event of events) {
    // Use the timestamp of the first timestamped event as createdAt
    if (!createdAt && 'ts' in event) createdAt = (event as { ts: number }).ts;

    if (event.type === 'initial_request') {
      request = event.request;
    } else if (event.type === 'metrics') {
      durationMs = event.durationMs;
      inputTokens = event.inputTokens;
      outputTokens = event.outputTokens;
      costUsd = event.costUsd;
    } else if (event.type === 'result') {
      if (event.subtype === 'success') status = 'ready';
    } else if (event.type === 'decision') {
      status = event.action === 'accepted' ? 'accepted' : 'rejected';
    }
  }

  return {
    id,
    branch: id,
    worktreePath,
    status,
    progressText: '',
    port: null,
    previewUrl: null,
    request,
    createdAt: createdAt || Date.now(),
    durationMs,
    inputTokens,
    outputTokens,
    costUsd,
  };
}
