# Re-encrypt credentials after agent stops if OAuth tokens refreshed

## What changed

When Claude Code runs using a user's stored `credentials.json` (OAuth flow), it may
silently refresh the `accessToken` / `expiresAt` while the agent is running. Previously
those refreshed tokens were discarded on cleanup — the next agent run would use the
stale credentials, requiring the user to re-paste them once they expired.

Three changes across the evolve pipeline handle this end-to-end:

### `scripts/claude-worker.ts` — cleanup()
After the agent finishes (success, error, timeout, or abort), the cleanup function now
reads the current `.credentials.json` before deleting it and compares it to the original
content passed in via `PRIMORDIA_USER_CREDENTIALS`. If the file changed (i.e. the OAuth
tokens were refreshed), the updated content is written to
`{worktreePath}/.credentials.updated` (mode 0o600) before the credentials file is
removed. This only happens when no other concurrent worker process is still using the
shared credentials file (same ref-counted lock-file logic as before).

### `app/api/evolve/stream/route.ts` — SSE poll loop
On each 500 ms poll the stream now checks for `.credentials.updated` in the session
worktree. If found, the file is read and immediately deleted, then its contents are
included as an `updatedCredentials` field in the next SSE payload sent to the browser.
This field is never written to the NDJSON log — it travels only through the in-flight
SSE response.

### `lib/credentials-client.ts` — new `updateStoredCredentials()`
A new helper that re-encrypts credentials using the **existing** AES-256-GCM key already
in `localStorage`, rather than generating a fresh one. This is important for token
refreshes: the server stores only one ciphertext per user, so rotating the AES key would
silently invalidate any other browser context that holds a cached copy of the old key.
Falls back to `setStoredCredentials()` (key generation path) only if no key exists yet.

### `app/evolve/session/[id]/EvolveSessionView.tsx` — SSE consumer
When the SSE payload contains `updatedCredentials`, the client calls
`updateStoredCredentials(updatedCredentials)`, which re-encrypts the new token data with
the existing AES key and POSTs the new ciphertext to
`/api/llm-key/encrypted-credentials`. The plaintext is never stored anywhere after this
call completes.

## Why

Claude Code's OAuth flow automatically refreshes tokens during a run. Without this fix,
token expiry forced users to manually re-paste credentials, even though the agent had
already fetched fresh ones. The fix keeps credentials in sync transparently.
