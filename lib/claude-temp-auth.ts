// lib/claude-temp-auth.ts
//
// Manages temporary Claude OAuth sessions.
//
// Flow:
//   1. startClaudeAuth()  — spawns `claude auth login` in a temp CLAUDE_CONFIG_DIR,
//                           waits for the OAuth URL to appear in stdout, returns
//                           { sessionId, url }.
//   2. completeClaudeAuth(sessionId, code)
//                        — sends the authorization code to the waiting process,
//                           waits for it to finish, reads .credentials.json,
//                           cleans up the temp dir, and returns the credentials
//                           JSON string.
//   3. cancelClaudeAuth(sessionId)
//                        — kills the process and cleans up without returning
//                           credentials.
//   4. subscribeToLogs(sessionId, callback)
//                        — subscribe to real-time stdout/stderr lines from the
//                           child process; used by the SSE log endpoint.
//
// Sessions are kept in a module-level Map so they survive across HTTP requests
// within the same server process.  The session is removed from the map once it
// reaches a terminal state (completed or cancelled).

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

// Path to the pexpect PTY wrapper script (relative to project root).
const PTY_SCRIPT = path.join(process.cwd(), 'scripts', 'claude-auth-pty.py');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ClaudeAuthSession {
  sessionId: string;
  url: string;
  /** Absolute path to the temp directory (CLAUDE_CONFIG_DIR). */
  tempDir: string;
}

export interface LogLine {
  source: 'stdout' | 'stderr' | 'system';
  text: string;
  ts: number; // Date.now()
}

interface ActiveSession extends ClaudeAuthSession {
  child: ChildProcessWithoutNullStreams;
  pid: number | undefined;
  /** Write the user's authorization code here to trigger completion. */
  submitCode: (code: string) => void;
  /** Resolves with the credentials JSON when the process finishes successfully. */
  credentialsPromise: Promise<string>;
  /** Buffered log lines (stdout + stderr + system messages). */
  logBuffer: LogLine[];
  /** Registered SSE subscribers; each receives new lines as they arrive. */
  logListeners: Set<(line: LogLine) => void>;
  /** True once the child has exited. */
  exited: boolean;
  exitCode: number | null;
}

// ─── In-memory session store ─────────────────────────────────────────────────

const sessions = new Map<string, ActiveSession>();

// Auto-expire sessions after 10 minutes to avoid leaking processes/temp dirs.
const SESSION_TTL_MS = 10 * 60 * 1000;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function cleanup(session: ActiveSession) {
  sessions.delete(session.sessionId);
  try {
    fs.rmSync(session.tempDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function emit(session: ActiveSession, source: LogLine['source'], text: string) {
  const line: LogLine = { source, text, ts: Date.now() };
  session.logBuffer.push(line);
  for (const listener of session.logListeners) {
    try { listener(line); } catch { /* ignore */ }
  }
}

function bufferStream(
  stream: NodeJS.ReadableStream,
  source: 'stdout' | 'stderr',
  session: ActiveSession,
) {
  let buf = '';
  stream.on('data', (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop()!;
    for (const line of lines) {
      emit(session, source, line);
    }
  });
  stream.on('end', () => {
    if (buf) {
      emit(session, source, buf);
      buf = '';
    }
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start a new OAuth session.
 *
 * Spawns `claude auth login --claudeai` in a fresh temporary directory,
 * waits until the OAuth URL appears in the process output, and returns the
 * sessionId + URL.  The process keeps running, waiting for the authorization
 * code on stdin.
 *
 * Rejects if claude does not emit a URL within 30 seconds.
 */
export function startClaudeAuth(): Promise<ClaudeAuthSession> {
  return new Promise((resolveStart, rejectStart) => {
    const sessionId = randomUUID();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-auth-'));

    // Spawn the pexpect PTY wrapper. It allocates a real PTY for claude so
    // that claude sees a terminal and reads the auth code via the PTY rather
    // than /dev/tty.  The wrapper speaks a simple line protocol on its own
    // stdio: "URL:<url>" then waits for us to write the code, then "DONE".
    const child = spawn('python3', [PTY_SCRIPT], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: tempDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    // Resolve credentialsPromise via these when submitCode() is called.
    let resolveCredentials!: (creds: string) => void;
    let rejectCredentials!: (err: Error) => void;

    const credentialsPromise = new Promise<string>((res, rej) => {
      resolveCredentials = res;
      rejectCredentials = rej;
    });

    // Build session object early so bufferStream can emit into it.
    const session: ActiveSession = {
      sessionId,
      url: '', // filled in below when URL is found
      tempDir,
      child,
      pid: child.pid,
      submitCode: (code: string) => {
        emit(session, 'system', `→ sending code to python wrapper stdin (${code.length} chars)`);
        try {
          // The pexpect wrapper reads one line from its stdin, then forwards
          // it to claude via the PTY.  We can close stdin after writing because
          // the wrapper only reads one line and then waits for pexpect.EOF.
          child.stdin.write(code + '\n');
          child.stdin.end();
          emit(session, 'system', '→ code written and stdin closed');
        } catch (err) {
          const msg = `Failed to write code to python wrapper stdin: ${err}`;
          emit(session, 'system', `✗ ${msg}`);
          rejectCredentials(new Error(msg));
        }
      },
      credentialsPromise,
      logBuffer: [],
      logListeners: new Set(),
      exited: false,
      exitCode: null,
    };

    emit(session, 'system', `spawned python3 claude-auth-pty.py (pid ${child.pid}), CLAUDE_CONFIG_DIR=${tempDir}`);
    emit(session, 'system', 'flow: theme ❯ → Enter, login ❯ → Enter, URL capture, code forward, /exit');

    // Buffer both stdout and stderr into the log so subscribers see everything.
    bufferStream(child.stdout, 'stdout', session);
    bufferStream(child.stderr, 'stderr', session);

    let urlFound = false;

    // Intercept stdout lines from the Python wrapper (protocol lines).
    // "URL:<url>"  → resolve the start promise
    // "DONE"       → wrapper finished cleanly; close event will read creds
    // "ERROR:<msg>"→ wrapper encountered a fatal error
    session.logListeners.add((line) => {
      if (line.source !== 'stdout') return;

      if (line.text.startsWith('URL:') && !urlFound) {
        urlFound = true;
        session.url = line.text.slice(4).trim();
        sessions.set(sessionId, session);

        // Auto-expire.
        setTimeout(() => {
          if (sessions.has(sessionId)) {
            emit(session, 'system', 'session expired (10 min TTL) — killing process');
            child.kill();
            cleanup(session);
          }
        }, SESSION_TTL_MS);

        resolveStart({ sessionId, url: session.url, tempDir });
      } else if (line.text.startsWith('ERROR:')) {
        const msg = line.text.slice(6);
        if (!urlFound) {
          rejectStart(new Error(msg));
        } else {
          rejectCredentials(new Error(msg));
        }
      }
      // "DONE" is informational; credentials are read in the close handler.
    });

    // When the process exits, try to read .credentials.json.
    child.on('close', (code) => {
      session.exited = true;
      session.exitCode = code;
      emit(session, 'system', `process exited with code ${code}`);

      const credPath = path.join(tempDir, '.credentials.json');
      const credExists = fs.existsSync(credPath);
      emit(session, 'system', `.credentials.json exists: ${credExists}`);

      if (credExists) {
        try {
          const creds = fs.readFileSync(credPath, 'utf8');
          emit(session, 'system', `credentials file read (${creds.length} bytes)`);
          resolveCredentials(creds);
        } catch (err) {
          rejectCredentials(new Error(`Failed to read .credentials.json: ${err}`));
        }
      } else {
        // List temp dir contents to aid debugging.
        try {
          const files = fs.readdirSync(tempDir);
          emit(session, 'system', `tempDir contents: [${files.join(', ')}]`);
        } catch { /* ignore */ }
        rejectCredentials(
          new Error(
            'Authentication failed: .credentials.json was not created. ' +
              'The code may be incorrect or the session may have expired.',
          ),
        );
      }
    });

    child.on('error', (err) => {
      emit(session, 'system', `process error: ${err.message}`);
      if (!urlFound) {
        rejectStart(new Error(`Failed to spawn claude: ${err.message}`));
      } else {
        rejectCredentials(new Error(`claude process error: ${err.message}`));
      }
    });

    // Timeout waiting for URL.
    setTimeout(() => {
      if (!urlFound) {
        child.kill();
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
        rejectStart(new Error('Timed out waiting for OAuth URL from claude (30 s)'));
      }
    }, 30_000);
  });
}

/**
 * Submit the authorization code for an existing session.
 *
 * Sends the code to the waiting claude process, waits for it to finish, reads
 * `.credentials.json`, and returns its contents as a string.  The temp
 * directory is deleted and the session is removed from the store.
 *
 * Rejects if the session is not found, the code is wrong, or the process
 * fails to produce credentials within 60 seconds.
 */
export async function completeClaudeAuth(sessionId: string, code: string): Promise<string> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown or expired session: ${sessionId}`);
  }

  session.submitCode(code);

  const credentials = await Promise.race([
    session.credentialsPromise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Timed out waiting for credentials after submitting code (60 s)')),
        60_000,
      ),
    ),
  ]);

  cleanup(session);
  return credentials;
}

/**
 * Cancel an in-progress session, killing the claude process and cleaning up
 * the temp directory.
 */
export function cancelClaudeAuth(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  emit(session, 'system', 'session cancelled by user');
  try { session.child.kill(); } catch { /* ignore */ }
  cleanup(session);
}

/**
 * Subscribe to real-time log lines from a session.
 * Returns an unsubscribe function.
 * Immediately replays buffered lines to the callback, then streams new ones.
 */
export function subscribeToLogs(
  sessionId: string,
  onLine: (line: LogLine) => void,
): { unsubscribe: () => void; found: boolean } {
  const session = sessions.get(sessionId);
  if (!session) return { unsubscribe: () => {}, found: false };

  // Replay buffer first.
  for (const line of session.logBuffer) {
    try { onLine(line); } catch { /* ignore */ }
  }

  if (session.exited) {
    return { unsubscribe: () => {}, found: true };
  }

  session.logListeners.add(onLine);
  return {
    unsubscribe: () => session.logListeners.delete(onLine),
    found: true,
  };
}

/**
 * Return a snapshot of current session state (for the test page status panel).
 */
export function getSessionDiagnostics(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return {
    pid: session.pid,
    exited: session.exited,
    exitCode: session.exitCode,
    tempDir: session.tempDir,
    logLineCount: session.logBuffer.length,
  };
}
