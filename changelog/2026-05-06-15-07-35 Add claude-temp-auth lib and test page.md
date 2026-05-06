# Add claude-temp-auth lib and test page

## What changed

- **`lib/claude-temp-auth.ts`** — new server-side module that manages temporary
  Claude OAuth sessions:
  - `startClaudeAuth()` — spawns `claude auth login --claudeai` in a freshly
    created `mkdtemp` directory (via `CLAUDE_CONFIG_DIR`), waits for the OAuth
    URL to appear in stdout, and returns `{ sessionId, url }`.  The process
    stays alive, blocking on stdin for the authorization code.
  - `completeClaudeAuth(sessionId, code)` — sends the code to the waiting
    process's stdin, waits for it to exit, reads `.credentials.json` from the
    temp dir, removes the temp dir, and returns the raw JSON string.
  - `cancelClaudeAuth(sessionId)` — kills the process and removes the temp dir
    without returning credentials.
  - Sessions auto-expire after 10 minutes.

- **`app/api/claude-auth/start/route.ts`** — `POST` endpoint; calls
  `startClaudeAuth()`, returns `{ sessionId, url }`.

- **`app/api/claude-auth/complete/route.ts`** — `POST` endpoint; accepts
  `{ sessionId, code }`, calls `completeClaudeAuth()`, returns
  `{ credentials }`.

- **`app/api/claude-auth/cancel/route.ts`** — `POST` endpoint; accepts
  `{ sessionId }`, calls `cancelClaudeAuth()`.

- **`app/test-pages/claude-auth-test/page.tsx`** — interactive test page that
  walks through the three-step flow (start → visit URL + paste code → copy
  credentials), with a step indicator, error banner, cancel button, and a
  copy-to-clipboard button for the resulting `.credentials.json`.

- **`app/test-pages/page.tsx`** — added the new test page to the index.

## Bug fixes

- **Blocked child process** — `stderr` was piped but never consumed; once the
  OS write buffer filled, `claude` blocked indefinitely and credentials were
  never written.  Fixed by calling `child.stderr.resume()` to drain stderr.
- **Lucide spinner** — replaced `⟳` text spinners in the test page with
  `<Loader2 className="animate-spin">` from `lucide-react`.
- **Live diagnostics** — `lib/claude-temp-auth.ts` now captures every stdout,
  stderr, and internal system event into a per-session `logBuffer` and fans
  them out to SSE subscribers via a `logListeners` Set. Added
  `app/api/claude-auth/logs/route.ts` (SSE, replays buffer then streams live).
  The test page subscribes as soon as a session starts and shows a live
  colour-coded log panel (stdout / stderr / system) so hangs are immediately
  visible.
- **stdin EOF bug** — `child.stdin.end()` was called immediately after writing
  the code, sending EOF to claude; this was reverted (open stdin also didn't
  work because the real problem is below).
- **PTY / full first-run flow** — `claude auth login --claudeai` only works
  when the browser is already logged in on the same machine; on a remote VM it
  silently ignores piped stdin because it reads the code via `/dev/tty`.
  Fixed by switching to the full interactive `claude` first-run wizard via
  `scripts/claude-auth-pty.py` (pexpect).  Probed the actual terminal output
  to discover the exact sequence: theme `❯` menu → `\r`, login-method `❯`
  menu → `\r` (selects Claude subscription), URL capture, code forwarded via
  PTY `sendline`, wait for REPL `>` → `/exit`.  Also handles post-auth yes/no or menu prompts and checks `.credentials.json`
  on unexpected EOF.
- **URL extraction & PTY width** — OAuth URL (~480 chars) wrapped across 3
  terminal lines at col 220; only the first fragment was captured.  Attempt
  to fix via `dimensions=(50, 10000)` broke the theme/login menus (claude
  omits the `❯` cursor at extreme widths).  Final fix: keep `(50, 220)`,
  wait for the `"Paste code here if prompted >"` prompt that always follows
  the URL, then reconstruct the full URL from `child.before` using
  `extract_url()` (strips ANSI, joins consecutive no-space lines starting
  from `https://`).
- **False REPL match** — `"Paste code here if prompted >"` was in pexpect’s
  buffer when we started waiting for the REPL `>` prompt, so `/exit` was
  sent before claude processed the code.  Fixed by polling
  `.credentials.json` (1 s interval, 120 s timeout) instead of any TTY
  pattern-matching — file existence is unambiguous.

## Why

Users need a way to obtain a `.credentials.json` for their Claude subscription
so they can use it for agent runs inside Primordia.  The flow requires an
interactive OAuth exchange (`claude auth login`) that can't happen in a
standard HTTP request — it spawns a subprocess and requires the user to visit
a URL and paste a code back.  This lib module and test page provide a
self-contained UI to complete that exchange without needing terminal access.
