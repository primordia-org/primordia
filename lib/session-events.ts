// lib/session-events.ts
// Structured event types for session progress logs.
// Events are stored as NDJSON (one JSON object per line) in
// {worktreePath}/.primordia-session.ndjson
//
// Session state is derived entirely from the filesystem and git:
//   .primordia-session.ndjson — structured event log (also serves as session existence marker)
//   git config branch.<name>.port — ephemeral dev-server port
//   git worktree list --porcelain — maps worktree paths to branch names
//
// Status is inferred from the NDJSON log via inferStatusFromEvents().
// Session ID equals the branch name. Branches with slashes are not supported.
// Preview URL is always /preview/<branchName> once the session is ready.
// Branch name is read from the git worktree list (or git symbolic-ref HEAD).

import * as fs from 'fs';
import * as path from 'path';
import type { EvolveSession } from './db/types';

export type SessionEvent =
  | { type: 'section_start'; sectionType: 'setup' | 'type_fix' | 'followup' | 'deploy' | 'conflict_resolution'; label: string; ts: number }
  | { type: 'section_start'; sectionType: 'agent'; harness: string; model: string; harnessId?: string; modelId?: string; label: string; ts: number }
  | { type: 'section_start'; sectionType: 'claude'; label: string; ts: number } // legacy
  | { type: 'setup_step'; label: string; done: boolean; ts: number }
  | { type: 'text'; content: string; ts: number }
  | { type: 'tool_use'; name: string; input: Record<string, unknown>; ts: number }
  | { type: 'result'; subtype: 'success' | 'error' | 'timeout' | 'aborted'; message?: string; ts: number }
  | { type: 'metrics'; durationMs: number | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; ts: number }
  | { type: 'log_line'; content: string; ts: number }
  | { type: 'initial_request'; request: string; attachments?: string[]; ts: number }
  | { type: 'followup_request'; request: string; attachments?: string[]; ts: number }
  | { type: 'decision'; action: 'accepted' | 'rejected'; detail: string; ts: number };

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

// ─── Status inference ─────────────────────────────────────────────────────────

/**
 * Infer the current session status from the NDJSON event log.
 *
 * Rules (checked in priority order):
 *   1. A `decision` event is terminal → 'accepted' or 'rejected'
 *   2. A `result` event with no `section_start` after it → 'ready'
 *   3. Last `section_start` type:
 *        'deploy'    → 'accepting'
 *        'type_fix'  → 'fixing-types'
 *        'claude'    → 'running-claude' (legacy)
 *        'agent'     → 'running-claude'
 *        'followup'  → 'running-claude' (immediately followed by 'agent'/'claude' in practice)
 *   4. Default → 'starting'
 */
export function inferStatusFromEvents(events: SessionEvent[]): string {
  let lastResultIdx = -1;
  let lastSectionStartIdx = -1;
  let lastSectionType: string | null = null;
  let decisionAction: string | null = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type === 'result') lastResultIdx = i;
    if (event.type === 'section_start') {
      lastSectionStartIdx = i;
      lastSectionType = event.sectionType;
    }
    if (event.type === 'decision') decisionAction = event.action;
  }

  if (decisionAction) return decisionAction; // 'accepted' or 'rejected'
  if (lastResultIdx >= 0 && lastSectionStartIdx <= lastResultIdx) return 'ready';
  if (lastSectionType === 'deploy') return 'accepting';
  if (lastSectionType === 'type_fix') return 'fixing-types';
  if (lastSectionType === 'agent' || lastSectionType === 'claude' || lastSectionType === 'followup' || lastSectionType === 'conflict_resolution') return 'running-claude';
  return 'starting';
}

// ─── Session lookup / enumeration ────────────────────────────────────────────

/**
 * Returns the candidate worktree path for a session.
 * Uses the sibling-directory convention of the flat worktree layout:
 * all worktrees live alongside the current one under the same parent directory.
 */
export function getCandidateWorktreePath(sessionId: string): string {
  return path.join(path.dirname(process.cwd()), sessionId);
}

/**
 * Build an EvolveSession from the NDJSON log and git metadata.
 * Returns null if the worktree doesn't have a session log.
 */
function buildSessionFromWorktreePath(
  id: string,
  worktreePath: string,
  branch: string,
  repoRoot: string,
): EvolveSession | null {
  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  if (!fs.existsSync(ndjsonPath)) return null;

  const { events } = readSessionEvents(ndjsonPath);
  const status = inferStatusFromEvents(events);
  const previewUrl = status === 'ready' ? `/preview/${id}` : null;

  let request = '';
  let createdAt = 0;
  let durationMs: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let costUsd: number | null = null;

  for (const event of events) {
    if (!createdAt && 'ts' in event) createdAt = (event as { ts: number }).ts;
    if (event.type === 'initial_request') {
      request = event.request;
    } else if (event.type === 'metrics') {
      // Sum across all metrics events (each records incremental cost/tokens for
      // one agent run; follow-ups write a delta rather than a cumulative total).
      if (event.durationMs != null) durationMs = (durationMs ?? 0) + event.durationMs;
      if (event.inputTokens != null) inputTokens = (inputTokens ?? 0) + event.inputTokens;
      if (event.outputTokens != null) outputTokens = (outputTokens ?? 0) + event.outputTokens;
      if (event.costUsd != null) costUsd = (costUsd ?? 0) + event.costUsd;
    }
  }

  // Read port from git config (stored when the worktree was created).
  let port: number | null = null;
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const out = execFileSync('git', ['config', '--get', `branch.${branch}.port`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (out) port = parseInt(out, 10);
  } catch { /* not set */ }

  return {
    id,
    branch,
    worktreePath,
    status,
    port,
    previewUrl,
    request,
    createdAt: createdAt || Date.now(),
    durationMs,
    inputTokens,
    outputTokens,
    costUsd,
  };
}

/**
 * Look up a session by ID from the filesystem.
 * Uses the sibling-directory convention to find the worktree.
 * Returns null if the session doesn't exist on disk.
 */
export function getSessionFromFilesystem(id: string, repoRoot: string): EvolveSession | null {
  const worktreePath = getCandidateWorktreePath(id);
  // Get branch name via git symbolic-ref HEAD in the worktree.
  // For from-branch sessions, the branch differs from the session ID.
  let branch = id;
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const ref = execFileSync('git', ['symbolic-ref', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (ref.startsWith('refs/heads/')) {
      branch = ref.slice('refs/heads/'.length);
    }
  } catch { /* worktree may not exist or be in detached HEAD */ }
  return buildSessionFromWorktreePath(id, worktreePath, branch, repoRoot);
}

/**
 * Enumerate all active sessions by scanning git worktrees.
 * A worktree is considered a session if it has a .primordia-session.ndjson file.
 * Returns sessions sorted by createdAt descending.
 */
export function listSessionsFromFilesystem(repoRoot: string): EvolveSession[] {
  const { execFileSync } = require('child_process') as typeof import('child_process');
  let porcelain: string;
  try {
    porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return [];
  }

  const sessions: EvolveSession[] = [];

  // Parse porcelain output: blocks are separated by blank lines.
  let currentPath: string | null = null;
  let currentBranch: string | null = null;

  const processBlock = () => {
    if (!currentPath) return;
    const branch = currentBranch ?? path.basename(currentPath);
    const session = buildSessionFromWorktreePath(path.basename(currentPath), currentPath, branch, repoRoot);
    if (session) sessions.push(session);
    currentPath = null;
    currentBranch = null;
  };

  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim();
      currentBranch = null;
    } else if (line.startsWith('branch refs/heads/')) {
      currentBranch = line.slice('branch refs/heads/'.length).trim();
    } else if (line === '') {
      processBlock();
    }
  }
  processBlock(); // handle last block (no trailing blank line)

  return sessions.sort((a, b) => b.createdAt - a.createdAt);
}
