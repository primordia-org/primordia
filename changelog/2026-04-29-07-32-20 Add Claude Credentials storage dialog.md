# Add Claude Credentials storage dialog and use credentials in evolve runs

## What changed

Added a new **Claude Credentials** dialog that lets users paste the contents of their `~/.claude/.credentials.json` file and store it encrypted. During evolve runs (initial and follow-up), the credentials are decrypted server-side and written to `CLAUDE_CONFIG_DIR/.credentials.json` for the duration of the Claude Code worker process, then immediately deleted afterwards. This lets users run evolve sessions using their own Claude Code subscription instead of the API key or exe.dev gateway.

### New files

- **`app/api/llm-key/encrypted-credentials/route.ts`** — GET/POST/DELETE API route that stores and retrieves the AES-GCM encrypted credentials ciphertext in `user_preferences`, mirroring `encrypted-key/route.ts`.
- **`lib/credentials-client.ts`** — Client-side helpers:
  - `hasStoredCredentials()` — checks whether credentials are configured on this device.
  - `setStoredCredentials(json | null)` — encrypts with a browser-generated AES-256-GCM key (stored in `localStorage`) and persists the ciphertext to the server; passing `null` clears both.
  - `encryptStoredCredentials()` — encrypts for in-request transmission using **hybrid encryption** (ephemeral AES-GCM encrypts the payload, RSA-OAEP encrypts only the 32-byte AES key) to handle credentials.json files that exceed RSA-OAEP's plaintext size limit.
- **`components/CredentialsDialog.tsx`** — Modal dialog with a textarea for pasting credentials.json, JSON validation, status indicator, save/clear actions, and Escape-to-close behaviour.

### Modified files

- **`components/HamburgerMenu.tsx`** — Added a **"Claude Credentials"** menu item (sky blue, `FileKey` icon) below the existing API Key item. Opens `CredentialsDialog` in the same pattern as `ApiKeyDialog`.
- **`lib/llm-encryption.ts`** — Added `decryptHybridCredentials({ wrappedKey, iv, ciphertext })`: unwraps the ephemeral AES key with RSA-OAEP, then decrypts the AES-GCM ciphertext to recover the credentials JSON string server-side.
- **`lib/evolve-sessions.ts`** — Added `credentials?: string` field to `LocalSession` and `WorkerConfig`. The `spawnAgentWorker` function now passes credentials via a `PRIMORDIA_USER_CREDENTIALS` environment variable (stripped from the JSON config file, like `apiKey`). All three `spawnAgentWorker` call sites (initial run, follow-up, conflict resolution) forward the field. The `resolveAgentAuth` helper enforces that Claude Credentials are only used when the `claude-code` harness is selected — Pi and other harnesses silently ignore stored credentials and fall back to API key or gateway.
- **`scripts/claude-worker.ts`** — At startup, reads `PRIMORDIA_USER_CREDENTIALS`, immediately clears the env var, then writes the credentials JSON to `$CLAUDE_CONFIG_DIR/.credentials.json` (mode 0600). The `cleanup()` function deletes the file on every exit path (success, error, timeout, abort).
- **`app/api/evolve/route.ts`** — Parses the new `encryptedCredentials` form/JSON field, decrypts it with `decryptHybridCredentials`, and assigns it to `session.credentials`.
- **`app/api/evolve/followup/route.ts`** — Same: decrypts and forwards `encryptedCredentials` for follow-up runs.
- **`components/EvolveRequestForm.tsx`** — Calls `encryptStoredCredentials()` on submit and appends the result as `encryptedCredentials` to the FormData.
- **`app/evolve/session/[id]/EvolveSessionView.tsx`** — Same for the follow-up form submit path.

## Why

Claude Code's OAuth session (stored in `~/.claude/.credentials.json`) allows users to run evolve sessions under their own Claude Code subscription, avoiding API key costs entirely. The credentials are treated as maximally sensitive:

- **At rest** (browser → server): browser-side AES-256-GCM + server-side ciphertext storage, same as the API key.
- **In transit** (browser → server per request): hybrid RSA-OAEP + AES-GCM because credentials.json can exceed RSA-OAEP's ~190-byte plaintext limit.
- **On disk** (server → Claude Code): written to `CLAUDE_CONFIG_DIR/.credentials.json` only for the duration of the worker process, with mode 0600, and deleted in the `cleanup()` function on every exit path (success, error, timeout, abort).
