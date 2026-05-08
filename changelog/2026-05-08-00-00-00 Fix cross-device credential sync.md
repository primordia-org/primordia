# Fix cross-device credential sync

## What changed

The QR sign-in flows (both push and pull) now correctly sync all credentials
across devices, not just the AES key.

### Two bugs fixed

**Bug 1 — Secrets index never updated after QR sync**

After receiving an AES key via QR, the receiving device saved the key to
localStorage but never updated its `primordia_secrets` presence index. Because
`hasSecret()` reads from that index, the UI and any code calling `hasSecret()`
believed no credentials were configured — even though they were all on the
server and decryptable.

**Bug 2 — AES key divergence across devices**

Each device generates its own AES-256-GCM key the first time it stores a
credential. If you set credentials on device A (key K_A) and separately on
device B (key K_B), the DB ends up with:

- `ANTHROPIC_API_KEY` encrypted with K_A
- `OPENROUTER_API_KEY` encrypted with K_B

When device B receives K_A via QR sync and stores it as its AES key, K_B is
discarded — and `OPENROUTER_API_KEY` (encrypted with K_B) becomes permanently
inaccessible to both devices.

### Fix

**New function `adoptNewAesKey(newKeyJwk)`** in `lib/secrets-client.ts`:

Before discarding the old key, it re-encrypts every locally-tracked credential
under the incoming key, stores the re-encrypted ciphertext back to the server,
then saves the new key. This unifies all credentials under one AES key so any
device holding that key can decrypt everything.

**New function `syncSecretsIndexFromServer()`** in `lib/secrets-client.ts`:

After adopting the key, fetches `GET /api/secrets` (new endpoint) and writes
the server's authoritative list of configured secrets to the local
`primordia_secrets` index. This makes the sender's credentials (which the
receiver didn't know about locally) immediately visible to `hasSecret()`.

**New endpoint `GET /api/secrets`** in `app/api/secrets/route.ts`:

Returns `{ types: SecretType[] }` — the list of secret types with non-empty
ciphertext stored for the authenticated user.

Both QR flows (push: `cross-device-receive/page.tsx`, pull:
`auth-tabs/cross-device/index.tsx`) now call `adoptNewAesKey` →
`syncSecretsIndexFromServer` instead of the bare `localStorage.setItem`.
