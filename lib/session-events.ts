// lib/session-events.ts
// Structured event types for session progress logs.
// Events are stored as NDJSON (one JSON object per line) in
// {worktreePath}/.primordia-session.ndjson

import * as fs from 'fs';
import * as path from 'path';

export type SessionEvent =
  | { type: 'section_start'; sectionType: 'setup' | 'claude' | 'type_fix' | 'followup' | 'deploy'; label: string; ts: number }
  | { type: 'setup_step'; label: string; done: boolean; ts: number }
  | { type: 'text'; content: string; ts: number }
  | { type: 'tool_use'; name: string; input: Record<string, unknown>; ts: number }
  | { type: 'result'; subtype: 'success' | 'error' | 'timeout' | 'aborted'; message?: string; ts: number }
  | { type: 'metrics'; durationMs: number | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; ts: number }
  | { type: 'log_line'; content: string; ts: number }
  | { type: 'initial_request'; request: string; ts: number }
  | { type: 'followup_request'; request: string; ts: number }
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
