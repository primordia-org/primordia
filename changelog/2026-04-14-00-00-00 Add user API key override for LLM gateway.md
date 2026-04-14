# Add user API key override for LLM gateway

## What changed

Users can now set their own Anthropic API key to override the exe.dev LLM gateway for both evolve (agent) runs and chat requests.

### New files

- **`lib/llm-encryption.ts`** — Server-side RSA-OAEP keypair manager. Generates a 2048-bit keypair once per server process lifetime (ephemeral, lost on restart). Exports `getPublicKeyJwk()` (returns the public key as JWK for the client) and `decryptApiKey(ciphertextBase64)` (decrypts a client-encrypted API key).

- **`app/api/llm-key/public-key/route.ts`** — `GET` endpoint that returns the server's current RSA public key as JWK. Requires auth. Clients call this to import the key into `crypto.subtle` before encrypting their API key.

- **`lib/api-key-client.ts`** — Client-side helpers (marked `"use client"`):
  - `getStoredApiKey()` / `setStoredApiKey(key)` — read/write the API key in `localStorage` (key: `primordia_anthropic_api_key`).
  - `encryptStoredApiKey()` — fetches the server public key, encrypts the stored key with RSA-OAEP (`crypto.subtle`), and returns the base64 ciphertext. Returns `null` if no key is stored.
  - `bustPublicKeyCache()` — clears the module-level public key cache (for retry after a decrypt error).

- **`components/ApiKeyDialog.tsx`** — Modal dialog component. Shows current key status (masked), an input field (password type, with show/hide toggle), Save and Clear buttons, and a link to the Anthropic console. Validates that the key starts with `sk-ant-`. The key is only ever stored in `localStorage` — never sent to the server in plaintext.

### Modified files

- **`lib/llm-client.ts`** — `getLlmClient(apiKey?)` now accepts an optional API key. When provided, it creates a standard Anthropic client (direct API). When omitted, it uses the gateway as before.

- **`lib/evolve-sessions.ts`** — `LocalSession` gains an optional `apiKey?: string` field (transient — never persisted to NDJSON or SQLite). `WorkerConfig` gains the same field. `spawnClaudeWorker()` strips `apiKey` from the JSON config written to disk and instead injects it as `PRIMORDIA_USER_API_KEY` in the worker's process environment.

- **`scripts/claude-worker.ts`** — Reads `PRIMORDIA_USER_API_KEY` from env at startup. If present: sets `ANTHROPIC_API_KEY` to that value and removes `ANTHROPIC_BASE_URL` (direct API). Otherwise: sets the gateway URL + `gateway` key as before. Deletes `PRIMORDIA_USER_API_KEY` from `process.env` immediately after reading so it does not appear in child processes spawned by Claude Code's Bash tool.

- **`scripts/pi-worker.ts`** — Same: reads + clears `PRIMORDIA_USER_API_KEY`. If present, uses it as the Anthropic API key and skips registering the gateway provider extension. Otherwise uses the gateway as before.

- **`app/api/evolve/route.ts`** — Accepts optional `encryptedApiKey` in both multipart FormData and JSON bodies. Decrypts it server-side right before constructing the session object, then assigns to `session.apiKey` and immediately clears the local variable.

- **`app/api/evolve/followup/route.ts`** — Same pattern.

- **`app/api/evolve/from-branch/route.ts`** — Same pattern.

- **`app/api/chat/route.ts`** — Accepts optional `encryptedApiKey` in the JSON body. Decrypts it and passes to `getLlmClient(userApiKey)`, then clears the variable before creating the SSE stream.

- **`components/EvolveRequestForm.tsx`** — Calls `encryptStoredApiKey()` before submitting; appends the result as `encryptedApiKey` in the FormData if a key is stored.

- **`components/EvolveSessionView.tsx`** — Same for followup form submissions.

- **`components/ChatInterface.tsx`** — Calls `encryptStoredApiKey()` before each chat POST; includes the result in the JSON body.

- **`components/HamburgerMenu.tsx`** — Adds an "API Key" item (Key icon, amber hover) to the dropdown for all logged-in users. Manages `ApiKeyDialog` open/close state internally; the dialog is rendered outside the dropdown so it is not clipped by overflow.

- **`AGENTS.md`** — Updated tech stack description, file map (new lib files, new API route, new component).

## Why

Previously all LLM calls (chat and evolve agents) routed exclusively through the exe.dev LLM gateway. Users on other platforms or users who want to use their own billing/quota had no way to bring their own key. This change adds that capability.

**Security design:**

- The API key is stored client-side in `localStorage` (the user's own device, their own data).
- It is **never** transmitted in plaintext — it is encrypted with RSA-OAEP using the server's ephemeral public key just before every request.
- On the server, the decrypted key lives only in a short-lived local variable; it is cleared immediately after being passed to the session object or the Anthropic client.
- The worker receives the key via an environment variable (not in the JSON config file on disk), and deletes it from `process.env` immediately after reading so child processes cannot inherit it.
- The server's private key is ephemeral (in-process memory only, never written to disk or logged).
