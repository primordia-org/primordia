# Client-side key encryption with server-stored ciphertext

## What changed

Redesigned API key storage so the encryption key never leaves the browser:

**Before:** The plaintext API key was stored directly in `localStorage`. On each request the client fetched the server's ephemeral RSA-OAEP public key and encrypted the plaintext before transmission. Anyone with access to `localStorage` could read the key in plaintext.

**After:**

1. **AES-256-GCM key in `localStorage`** — when the user saves an API key, the browser generates a fresh AES-256-GCM key and stores it in `localStorage` under `primordia_aes_key` (as an exported JWK). This key never leaves the browser.

2. **Encrypted ciphertext on the server** — the API key is AES-GCM encrypted (with a random 12-byte IV) and the `{ iv, ciphertext }` payload is stored server-side in `user_preferences` (key: `encrypted_api_key`), bound to the authenticated user account.

3. **Decryption stays in the browser** — when a request needs the API key, the browser:
   - Fetches the encrypted ciphertext from `GET /api/llm-key/encrypted-key`
   - Decrypts locally using the AES key from `localStorage`
   - Re-encrypts the plaintext with the server's ephemeral RSA-OAEP public key (existing mechanism)
   - Sends only the RSA ciphertext in the request body

   The server decrypts the RSA envelope, uses the key immediately, and discards it — exactly as before.

## Files changed

- **`lib/api-key-client.ts`** — rewrote to use AES-GCM key management; `setStoredApiKey` is now async; `getStoredApiKey` replaced by `hasStoredApiKey` (boolean).
- **`components/ApiKeyDialog.tsx`** — updated to call async save/clear, show loading state, and display status without revealing the plaintext key.
- **`app/api/llm-key/encrypted-key/route.ts`** — new endpoint: `GET` / `POST` / `DELETE` for the per-user encrypted ciphertext.

## Why

Storing a plaintext API key in `localStorage` means any JavaScript running in the same origin (e.g. a compromised dependency or an XSS vector) can read it with `localStorage.getItem(...)`. By splitting storage across the browser (AES key) and server (ciphertext), neither side alone holds enough information to reconstruct the API key.
