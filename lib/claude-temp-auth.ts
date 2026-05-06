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
//
// Sessions are kept in a module-level Map so they survive across HTTP requests
// within the same server process.  The session is removed from the map once it
// reaches a terminal state (completed or cancelled).

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ClaudeAuthSession {
  sessionId: string;
  url: string;
  /** Absolute path to the temp directory (CLAUDE_CONFIG_DIR). */
  tempDir: string;
}

interface ActiveSession extends ClaudeAuthSession {
  child: ChildProcessWithoutNullStreams;
  /** Write the user's authorization code here to trigger completion. */
  submitCode: (code: string) => void;
  /** Resolves with the credentials JSON when the process finishes successfully. */
  credentialsPromise: Promise<string>;
}

// ─── In-memory session store ─────────────────────────────────────────────────

const sessions = new Map<string, ActiveSession>();

// Auto-expire sessions after 10 minutes to avoid leaking processes/temp dirs.
const SESSION_TTL_MS = 10 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cleanup(session: ActiveSession) {
  sessions.delete(session.sessionId);
  try {
    fs.rmSync(session.tempDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
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

    const child = spawn('claude', ['auth', 'login', '--claudeai'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: tempDir },
      // pipe stdin so we can send the code later; pipe stdout to capture URL;
      // pipe stderr too (we'll ignore it — the TTY output isn't needed server-side)
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    let urlFound = false;
    let stdoutBuf = '';

    // Resolve credentialsPromise via these when submitCode() is called.
    let resolveCredentials!: (creds: string) => void;
    let rejectCredentials!: (err: Error) => void;

    const credentialsPromise = new Promise<string>((res, rej) => {
      resolveCredentials = res;
      rejectCredentials = rej;
    });

    function submitCode(code: string) {
      try {
        child.stdin.write(code + '\n');
        child.stdin.end();
      } catch {
        rejectCredentials(new Error('Failed to write code to claude stdin'));
      }
    }

    // Watch stdout for the URL line.
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop()!;

      for (const line of lines) {
        const match = line.match(/https?:\/\/\S+/);
        if (match && !urlFound) {
          urlFound = true;
          const url = match[0];

          const session: ActiveSession = {
            sessionId,
            url,
            tempDir,
            child,
            submitCode,
            credentialsPromise,
          };
          sessions.set(sessionId, session);

          // Auto-expire.
          setTimeout(() => {
            if (sessions.has(sessionId)) {
              child.kill();
              cleanup(session);
            }
          }, SESSION_TTL_MS);

          resolveStart({ sessionId, url, tempDir });
        }
      }
    });

    // When the process exits, try to read .credentials.json.
    child.on('close', () => {
      const credPath = path.join(tempDir, '.credentials.json');
      if (fs.existsSync(credPath)) {
        try {
          const creds = fs.readFileSync(credPath, 'utf8');
          resolveCredentials(creds);
        } catch (err) {
          rejectCredentials(new Error(`Failed to read .credentials.json: ${err}`));
        }
      } else {
        rejectCredentials(
          new Error(
            'Authentication failed: .credentials.json was not created. ' +
              'The code may be incorrect or the session may have expired.',
          ),
        );
      }
    });

    child.on('error', (err) => {
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

  // Send code and wait.  Race against a 60 s timeout.
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
  try { session.child.kill(); } catch { /* ignore */ }
  cleanup(session);
}
