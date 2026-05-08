"use client";

// lib/secrets-client.ts
// Unified client-side helpers for storing and encrypting user secrets
// (API keys and Claude Code credentials).
//
// Architecture:
//   - ONE AES-256-GCM key per user stored in localStorage ('primordia_aes_key').
//     All secret types share this key — simplifies cross-device AES key sync.
//   - Each secret type is stored server-side under its own preference key
//     (see /api/secrets/[type]) using AES-GCM with a per-save random IV.
//   - No local presence index — always ask the server whether a secret is set.
//   - For transmission, API keys use RSA-OAEP (small payload).
//     Credentials use hybrid encryption (ephemeral AES + RSA-OAEP wrapped key)
//     because credentials.json can exceed RSA-OAEP's ~190-byte plaintext limit.
//
// Key that never leaves the browser: the AES-256-GCM key in localStorage.
// Key that never leaves the server process: the RSA-OAEP private key.

import { withBasePath } from './base-path';

export type SecretType =
  | 'ANTHROPIC_API_KEY'
  | 'OPENROUTER_API_KEY'
  | 'OPENAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'CLAUDE_CODE_CREDENTIALS_JSON';

const AES_KEY_STORAGE = 'primordia_aes_key';

// Module-level caches — reset on page load / module re-import.
let cachedAesKey: CryptoKey | null = null;
let cachedPublicKey: CryptoKey | null = null;

// ── AES-GCM key management ──────────────────────────────────────────────────

async function loadAesKey(): Promise<CryptoKey | null> {
  if (cachedAesKey) return cachedAesKey;
  if (typeof window === 'undefined') return null;
  try {
    const jwkStr = localStorage.getItem(AES_KEY_STORAGE);
    if (!jwkStr) return null;
    const jwk = JSON.parse(jwkStr) as JsonWebKey;
    cachedAesKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'AES-GCM' },
      false, // not extractable after import — prevents JS exfiltration
      ['encrypt', 'decrypt'],
    );
    return cachedAesKey;
  } catch {
    return null;
  }
}

async function getOrCreateAesKey(): Promise<CryptoKey> {
  const existing = await loadAesKey();
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable so we can export to localStorage
    ['encrypt', 'decrypt'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', key);
  localStorage.setItem(AES_KEY_STORAGE, JSON.stringify(jwk));
  cachedAesKey = key;
  return key;
}

// ── RSA-OAEP public key ─────────────────────────────────────────────────────

/** Invalidates the cached RSA public key so it is re-fetched on next use. */
export function bustPublicKeyCache(): void {
  cachedPublicKey = null;
}

async function fetchPublicKey(): Promise<CryptoKey> {
  if (cachedPublicKey) return cachedPublicKey;
  const res = await fetch(withBasePath('/api/llm-key/public-key'));
  if (!res.ok) throw new Error(`Failed to fetch server public key: ${res.statusText}`);
  const data = (await res.json()) as { publicKey: JsonWebKey };
  const key = await crypto.subtle.importKey(
    'jwk',
    data.publicKey,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  cachedPublicKey = key;
  return key;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Encrypts and stores a secret server-side.
 * Generates the shared AES key if this is the first secret set on this device.
 */
export async function setSecret(type: SecretType, value: string): Promise<void> {
  if (typeof window === 'undefined') return;

  const aesKey = await getOrCreateAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(value),
  );

  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

  const res = await fetch(withBasePath(`/api/secrets/${type}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ iv: ivB64, ciphertext: ctB64 }),
  });
  if (!res.ok) {
    throw new Error(`Failed to store ${type} on server: ${res.statusText}`);
  }
}

/**
 * Re-encrypts a secret using the EXISTING AES key without changing it.
 * Use for server-side refreshes (e.g. OAuth token rotation) where the key
 * must remain stable so other browser contexts can still decrypt.
 * Falls back to setSecret() if no AES key exists yet.
 */
export async function updateSecret(type: SecretType, value: string): Promise<void> {
  const aesKey = await loadAesKey();
  if (!aesKey) return setSecret(type, value);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(value),
  );

  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

  const res = await fetch(withBasePath(`/api/secrets/${type}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ iv: ivB64, ciphertext: ctB64 }),
  });
  if (!res.ok) throw new Error(`Failed to update ${type} on server: ${res.statusText}`);
}

/**
 * Removes a secret from the server. If this was the last secret stored for
 * this user, also removes the shared AES key from localStorage.
 */
export async function clearSecret(type: SecretType): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    await fetch(withBasePath(`/api/secrets/${type}`), { method: 'DELETE' });
  } catch {
    // Best-effort — continue to check remaining secrets
  }

  // If no secrets remain on the server, remove the local AES key.
  try {
    const res = await fetch(withBasePath('/api/secrets'));
    if (res.ok) {
      const data = (await res.json()) as { types: SecretType[] };
      if (data.types.length === 0) {
        cachedAesKey = null;
        localStorage.removeItem(AES_KEY_STORAGE);
      }
    }
  } catch {
    // Best-effort
  }
}

/**
 * Removes the local AES key without touching the server.
 * Use when the server has no ciphertext for this user (e.g. account reset)
 * and the local key is orphaned.
 */
export function clearOrphanedSecretsKey(): void {
  if (typeof window === 'undefined') return;
  try {
    cachedAesKey = null;
    localStorage.removeItem(AES_KEY_STORAGE);
  } catch {}
}

/**
 * Called after receiving a foreign AES key via cross-device QR sync.
 *
 * Fetches all secrets currently stored on the server for this user and
 * tries to re-encrypt each one under the incoming key. Secrets that were
 * already encrypted with the new key (the sender's own credentials) fail
 * the decrypt step and are skipped — only this device's own secrets
 * (encrypted with its old key) get migrated. Then saves the new key.
 *
 * The result: all secrets in the DB end up under a single AES key that
 * both devices now hold.
 */
export async function adoptNewAesKey(newKeyJwkStr: string): Promise<void> {
  if (typeof window === 'undefined') return;

  const oldKeyJwkStr = localStorage.getItem(AES_KEY_STORAGE);

  if (!oldKeyJwkStr || oldKeyJwkStr === newKeyJwkStr) {
    localStorage.setItem(AES_KEY_STORAGE, newKeyJwkStr);
    cachedAesKey = null;
    return;
  }

  let oldKey: CryptoKey;
  let newKey: CryptoKey;
  try {
    oldKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(oldKeyJwkStr) as JsonWebKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    newKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(newKeyJwkStr) as JsonWebKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
  } catch {
    // Can't import keys — just adopt the new key without migrating.
    localStorage.setItem(AES_KEY_STORAGE, newKeyJwkStr);
    cachedAesKey = null;
    return;
  }

  // Ask the server which types have ciphertext so we know what to migrate.
  let types: SecretType[] = [];
  try {
    const listRes = await fetch(withBasePath('/api/secrets'));
    if (listRes.ok) {
      const data = (await listRes.json()) as { types: SecretType[] };
      types = data.types;
    }
  } catch {}

  for (const type of types) {
    try {
      const res = await fetch(withBasePath(`/api/secrets/${type}`));
      if (!res.ok) continue;
      const data = (await res.json()) as { ciphertext: string | null };
      if (!data.ciphertext) continue;

      const { iv: ivB64, ciphertext: ctB64 } = JSON.parse(data.ciphertext) as {
        iv: string;
        ciphertext: string;
      };
      const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
      const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, oldKey, ct);

      const newIv = crypto.getRandomValues(new Uint8Array(12));
      const newCt = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: newIv }, newKey, plaintext);
      const newIvB64 = btoa(String.fromCharCode(...newIv));
      const newCtB64 = btoa(String.fromCharCode(...new Uint8Array(newCt)));

      await fetch(withBasePath(`/api/secrets/${type}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iv: newIvB64, ciphertext: newCtB64 }),
      });
    } catch {
      // Decrypt failed (already uses new key) or network error — skip.
    }
  }

  localStorage.setItem(AES_KEY_STORAGE, newKeyJwkStr);
  cachedAesKey = null;
}

/**
 * Returns an API key ready for secure transmission using RSA-OAEP:
 *   1. Load the shared AES key from localStorage.
 *   2. Fetch the AES-encrypted ciphertext from the server.
 *   3. Decrypt locally to recover the plaintext key.
 *   4. Re-encrypt with the server's ephemeral RSA-OAEP public key.
 *
 * Not for use with CLAUDE_CODE_CREDENTIALS_JSON — use encryptCredentialsForTransmission().
 * Returns null if no key is configured on this device or any step fails.
 */
export async function encryptSecretForTransmission(
  type: Exclude<SecretType, 'CLAUDE_CODE_CREDENTIALS_JSON'>,
): Promise<string | null> {
  try {
    const aesKey = await loadAesKey();
    if (!aesKey) return null;

    const res = await fetch(withBasePath(`/api/secrets/${type}`));
    if (!res.ok) return null;

    const data = (await res.json()) as { ciphertext: string | null };
    if (!data.ciphertext) return null;

    const { iv: ivB64, ciphertext: ctB64 } = JSON.parse(data.ciphertext) as {
      iv: string;
      ciphertext: string;
    };

    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);

    const publicKey = await fetchPublicKey();
    const rsaEncrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, plaintext);
    return btoa(String.fromCharCode(...new Uint8Array(rsaEncrypted)));
  } catch (err) {
    console.error(`[secrets-client] Failed to encrypt ${type} for transmission:`, err);
    return null;
  }
}

/**
 * Returns Claude Code credentials ready for secure transmission using hybrid
 * encryption (because credentials.json can exceed RSA-OAEP's ~190-byte limit):
 *   1. Load the shared AES key from localStorage.
 *   2. Fetch + decrypt the AES-encrypted credentials from the server.
 *   3. Generate a fresh ephemeral AES key, encrypt the credentials with it.
 *   4. Wrap the ephemeral AES key with the server's RSA-OAEP public key.
 *
 * Returns null if no credentials are configured on this device or any step fails.
 * The plaintext credentials exist only as a transient ArrayBuffer in memory.
 *
 * Returned shape: { wrappedKey, iv, ciphertext } — all base64-encoded.
 * The server decrypts wrappedKey with its RSA private key to recover the
 * ephemeral AES key, then uses it to decrypt the ciphertext.
 */
export async function encryptCredentialsForTransmission(): Promise<{
  wrappedKey: string;
  iv: string;
  ciphertext: string;
} | null> {
  try {
    const aesKey = await loadAesKey();
    if (!aesKey) return null;

    const res = await fetch(withBasePath('/api/secrets/CLAUDE_CODE_CREDENTIALS_JSON'));
    if (!res.ok) return null;

    const data = (await res.json()) as { ciphertext: string | null };
    if (!data.ciphertext) return null;

    const { iv: ivB64, ciphertext: ctB64 } = JSON.parse(data.ciphertext) as {
      iv: string;
      ciphertext: string;
    };

    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);

    const ephemeralKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt'],
    );
    const ephemeralIv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedPayload = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ephemeralIv },
      ephemeralKey,
      plaintext,
    );

    const publicKey = await fetchPublicKey();
    const ephemeralKeyRaw = await crypto.subtle.exportKey('raw', ephemeralKey);
    const wrappedKey = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      ephemeralKeyRaw,
    );

    return {
      wrappedKey: btoa(String.fromCharCode(...new Uint8Array(wrappedKey))),
      iv: btoa(String.fromCharCode(...ephemeralIv)),
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(encryptedPayload))),
    };
  } catch (err) {
    console.error('[secrets-client] Failed to encrypt credentials for transmission:', err);
    return null;
  }
}
