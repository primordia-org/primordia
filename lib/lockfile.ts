import * as fs from 'fs';
import * as path from 'path';

export interface PidLockHandle {
  path: string;
  pid: number;
  release(): void;
}

export interface AcquirePidLockResult {
  acquired: boolean;
  path: string;
  pid: number | null;
  handle: PidLockHandle | null;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPidFile(filePath: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(filePath, 'utf8').trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function readLivePidFile(filePath: string, options: { removeStale?: boolean } = {}): number | null {
  const pid = readPidFile(filePath);
  if (pid !== null && isPidAlive(pid)) return pid;
  if (options.removeStale) removeLockFile(filePath);
  return null;
}

export function writePidFile(filePath: string, pid = process.pid, options: { mode?: number } = {}): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${pid}\n`, { mode: options.mode });
}

export function removeLockFile(filePath: string): void {
  try { fs.rmSync(filePath, { force: true }); } catch { /* best-effort */ }
}

export function releasePidLock(handle: Pick<PidLockHandle, 'path' | 'pid'>): void {
  if (readPidFile(handle.path) === handle.pid) removeLockFile(handle.path);
}

export function acquirePidLock(filePath: string, pid = process.pid): AcquirePidLockResult {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    const fd = fs.openSync(filePath, 'wx');
    try {
      fs.writeFileSync(fd, `${pid}\n`);
    } finally {
      fs.closeSync(fd);
    }
    const handle: PidLockHandle = {
      path: filePath,
      pid,
      release() { releasePidLock(handle); },
    };
    return { acquired: true, path: filePath, pid, handle };
  } catch {
    const existingPid = readPidFile(filePath);
    if (existingPid !== null && isPidAlive(existingPid)) {
      return { acquired: false, path: filePath, pid: existingPid, handle: null };
    }
    removeLockFile(filePath);
    return acquirePidLock(filePath, pid);
  }
}

export function writeScopedPidLock(directory: string, filename: string, pid = process.pid, options: { mode?: number } = {}): PidLockHandle {
  const filePath = path.join(directory, filename);
  writePidFile(filePath, pid, options);
  const handle: PidLockHandle = {
    path: filePath,
    pid,
    release() { releasePidLock(handle); },
  };
  return handle;
}

export function listLivePidLockFiles(directory: string, pattern: RegExp, options: { removeStale?: boolean } = {}): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return [];
  }
  const live: string[] = [];
  for (const entry of entries) {
    if (!pattern.test(entry)) continue;
    const filePath = path.join(directory, entry);
    const pid = readPidFile(filePath);
    if (pid !== null && isPidAlive(pid)) {
      live.push(entry);
    } else if (options.removeStale) {
      removeLockFile(filePath);
    }
  }
  return live;
}
