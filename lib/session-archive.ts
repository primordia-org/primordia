import * as fs from 'fs';
import * as path from 'path';
import { gzipSync } from 'zlib';
import { getSessionNdjsonPath } from './session-events';

export interface ArchiveSessionNdjsonOptions {
  /** Branch/session id. Used only for the archive filename. */
  sessionId?: string | null;
  /** Primordia installation root. Defaults to PRIMORDIA_DIR, then process.cwd(). */
  primordiaDir?: string | null;
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
}

function utcTimestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function uniqueArchivePath(directory: string, baseName: string): string {
  let candidate = path.join(directory, baseName);
  if (!fs.existsSync(candidate)) return candidate;

  const suffix = '.ndjson.gz';
  const stem = baseName.endsWith(suffix) ? baseName.slice(0, -suffix.length) : baseName;
  for (let i = 2; ; i++) {
    candidate = path.join(directory, `${stem}-${i}${suffix}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

/**
 * Saves a gzipped copy of a session's structured NDJSON log before the owning
 * worktree is deleted. Missing or empty logs are ignored so cleanup paths do
 * not fail for non-session worktrees or already-pruned directories.
 */
export function archiveSessionNdjsonLog(
  worktreePath: string,
  options: ArchiveSessionNdjsonOptions = {},
): string | null {
  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  if (!fs.existsSync(ndjsonPath)) return null;

  const content = fs.readFileSync(ndjsonPath);
  if (content.length === 0) return null;

  const primordiaDir = options.primordiaDir || process.env.PRIMORDIA_DIR || process.cwd();
  const archiveDir = path.join(primordiaDir, 'past-sessions');
  fs.mkdirSync(archiveDir, { recursive: true });

  const sessionPart = safeFilenamePart(options.sessionId || path.basename(worktreePath));
  const archivePath = uniqueArchivePath(
    archiveDir,
    `${utcTimestampForFilename()}-${sessionPart}.ndjson.gz`,
  );
  fs.writeFileSync(archivePath, gzipSync(content));
  return archivePath;
}
