// lib/session-events.ts
// Structured event types for session progress logs.
// Events are stored as NDJSON (one JSON object per line) in
// {worktreePath}/.primordia-session.ndjson
//
// Session state is stored entirely on the filesystem:
//   .primordia-status      — current status string (plain text)
//   .primordia-preview-url — preview URL when ready (plain text, absent = null)
//   .primordia-branch      — branch name (plain text, absent = sessionId)
//   .primordia-session.ndjson — structured event log

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

// ─── Filesystem state helpers ─────────────────────────────────────────────────

/** Read the current session status from the filesystem. Defaults to 'starting'. */
export function readSessionStatus(worktreePath: string): string {
  try {
    return fs.readFileSync(path.join(worktreePath, '.primordia-status'), 'utf8').trim() || 'starting';
  } catch {
    return 'starting';
  }
}

/** Write the current session status to the filesystem. */
export function writeSessionStatus(worktreePath: string, status: string): void {
  try {
    fs.writeFileSync(path.join(worktreePath, '.primordia-status'), status, 'utf8');
  } catch { /* best-effort */ }
}

/** Read the preview URL from the filesystem. Returns null if not set. */
export function readSessionPreviewUrl(worktreePath: string): string | null {
  try {
    const url = fs.readFileSync(path.join(worktreePath, '.primordia-preview-url'), 'utf8').trim();
    return url || null;
  } catch {
    return null;
  }
}

/** Write the preview URL to the filesystem. Pass null to clear it. */
export function writeSessionPreviewUrl(worktreePath: string, url: string | null): void {
  const filePath = path.join(worktreePath, '.primordia-preview-url');
  try {
    if (url) {
      fs.writeFileSync(filePath, url, 'utf8');
    } else {
      fs.rmSync(filePath, { force: true });
    }
  } catch { /* best-effort */ }
}

/**
 * Read the branch name from the filesystem.
 * For normal sessions, branch === sessionId. For from-branch sessions,
 * the branch name is stored explicitly since it may differ from the session ID.
 */
export function readSessionBranch(worktreePath: string, sessionId: string): string {
  try {
    const branch = fs.readFileSync(path.join(worktreePath, '.primordia-branch'), 'utf8').trim();
    return branch || sessionId;
  } catch {
    return sessionId;
  }
}

/** Write the branch name to the filesystem. */
export function writeSessionBranch(worktreePath: string, branch: string): void {
  try {
    fs.writeFileSync(path.join(worktreePath, '.primordia-branch'), branch, 'utf8');
  } catch { /* best-effort */ }
}

// ─── Session lookup / enumeration ────────────────────────────────────────────

/**
 * Returns the candidate worktree path for a session that isn't in the database.
 * Uses the sibling-directory convention of the flat worktree layout:
 * all worktrees live alongside the current one under the same parent directory.
 */
export function getCandidateWorktreePath(sessionId: string): string {
  return path.join(path.dirname(process.cwd()), sessionId);
}

/**
 * Build an EvolveSession from the filesystem state files and NDJSON log.
 * Returns null if the worktree doesn't exist or has no status file.
 */
function buildSessionFromWorktreePath(
  id: string,
  worktreePath: string,
  repoRoot: string,
): EvolveSession | null {
  if (!fs.existsSync(path.join(worktreePath, '.primordia-status'))) return null;

  const status = readSessionStatus(worktreePath);
  const previewUrl = readSessionPreviewUrl(worktreePath);
  const branch = readSessionBranch(worktreePath, id);

  let request = '';
  let createdAt = 0;
  let durationMs: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let costUsd: number | null = null;

  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  if (fs.existsSync(ndjsonPath)) {
    const { events } = readSessionEvents(ndjsonPath);
    for (const event of events) {
      if (!createdAt && 'ts' in event) createdAt = (event as { ts: number }).ts;
      if (event.type === 'initial_request') {
        request = event.request;
      } else if (event.type === 'metrics') {
        durationMs = event.durationMs;
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
        costUsd = event.costUsd;
      }
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
    progressText: '',
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
  return buildSessionFromWorktreePath(id, worktreePath, repoRoot);
}

/**
 * Enumerate all active sessions by scanning git worktrees.
 * A worktree is considered a session if it has a .primordia-status file.
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
  const processBlock = () => {
    if (!currentPath) return;
    const session = buildSessionFromWorktreePath(path.basename(currentPath), currentPath, repoRoot);
    if (session) sessions.push(session);
    currentPath = null;
  };

  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim();
    } else if (line === '') {
      processBlock();
    }
  }
  processBlock(); // handle last block (no trailing blank line)

  return sessions.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Attempts to reconstruct an EvolveSession record from the NDJSON log alone.
 * Useful when the session exists in a sibling worktree but not in the local DB
 * (e.g. the DB was copied before this session was created in a parent worktree).
 * Returns null if no log file exists or it contains no parseable events.
 *
 * @deprecated Prefer getSessionFromFilesystem() which also reads the status file.
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

  // Prefer the status file when available; fall back to inferring from events.
  let status = readSessionStatus(worktreePath);
  const hasStatusFile = fs.existsSync(path.join(worktreePath, '.primordia-status'));

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
    } else if (!hasStatusFile) {
      // Only infer status from events when no status file exists (legacy sessions).
      if (event.type === 'result') {
        if (event.subtype === 'success') status = 'ready';
      } else if (event.type === 'decision') {
        status = event.action === 'accepted' ? 'accepted' : 'rejected';
      }
    }
  }

  return {
    id,
    branch: id,
    worktreePath,
    status,
    progressText: '',
    port: null,
    previewUrl: readSessionPreviewUrl(worktreePath),
    request,
    createdAt: createdAt || Date.now(),
    durationMs,
    inputTokens,
    outputTokens,
    costUsd,
  };
}
