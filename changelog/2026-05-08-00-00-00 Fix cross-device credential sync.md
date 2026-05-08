# Fix cross-device credential sync

## What changed

The QR sign-in flows (both push and pull) now correctly sync all credentials
across devices, not just the AES key. The `primordia_secrets` local presence
index has also been removed — the server is now the sole source of truth for
which secrets are configured.

### Two bugs fixed

**Bug 1 — Secrets index never updated after QR sync**

After receiving an AES key via QR, the receiving device saved the key to
localStorage but never updated its `primordia_secrets` presence index. Because
`hasSecret()` reads from that index, the UI believed no credentials were
configured — even though they were all on the server and decryptable.

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

Fetches `GET /api/secrets` to get the server's list of all stored secret types,
then tries to decrypt each one with the old key and re-encrypt it with the
incoming key. Secrets already encrypted with the new key (the sender's own
credentials) fail the decrypt step and are safely skipped. The result: all
credentials in the DB end up under one shared AES key. Both QR flows now call
`adoptNewAesKey` instead of a bare `localStorage.setItem`.

**New endpoint `GET /api/secrets`** in `app/api/secrets/route.ts`:

Returns `{ types: SecretType[] }` — the list of secret types with non-empty
ciphertext stored for the authenticated user. Used by `adoptNewAesKey` to know
what to migrate, and by UI components to check which credentials are active.

**Removed the local secrets presence index (`primordia_secrets`)**

The index was a `localStorage` list that tracked which secret types were
configured on the current device. It was the root cause of Bug 1 (stale after
QR sync) and added fragile state that could diverge from the server.

Removed: `hasSecret()`, `readSecretsIndex()`, `writeSecretsIndex()`,
`syncSecretsIndexFromServer()`, `hasStoredApiKey()`, `hasStoredOpenRouterApiKey()`,
`hasStoredCredentials()`, `clearOrphanedCredentialsKey()`.

All UI components (`SettingsSubNav`, `ApiKeySettingsClient`,
`CredentialsSettingsClient`) now check credential status by fetching from the
server on mount, which is both simpler and always accurate.
