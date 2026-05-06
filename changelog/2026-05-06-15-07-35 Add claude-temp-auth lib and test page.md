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

## Why

Users need a way to obtain a `.credentials.json` for their Claude subscription
so they can use it for agent runs inside Primordia.  The flow requires an
interactive OAuth exchange (`claude auth login`) that can't happen in a
standard HTTP request — it spawns a subprocess and requires the user to visit
a URL and paste a code back.  This lib module and test page provide a
self-contained UI to complete that exchange without needing terminal access.
