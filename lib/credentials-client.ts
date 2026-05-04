"use client";

// lib/credentials-client.ts
// Client-side helpers for storing and encrypting Claude Code credentials.json.
//
// Mirrors the same architecture as lib/api-key-client.ts:
//   - An AES-256-GCM key is generated in the browser and stored in localStorage.
//     It never leaves the browser.
//   - The credentials JSON is encrypted with that AES key; the ciphertext is
//     stored server-side (in user_preferences), bound to the authenticated user.
//   - When the credentials need to be sent in a request, the browser decrypts
//     locally and re-encrypts with the server's ephemeral RSA-OAEP public key.
//     Because credentials.json can be larger than RSA-OAEP's plaintext limit,
//     a hybrid scheme is used: an ephemeral AES key encrypts the payload, and
//     RSA-OAEP encrypts only that small AES key.
//
// Key that never leaves the browser: the AES-256-GCM key in localStorage.
// Key that never leaves the server process: the RSA-OAEP private key.

import { withBasePath } from './base-path';

const AES_KEY_STORAGE = 'primordia_credentials_aes_key'; // localStorage: AES-GCM key as JWK

// Module-level caches — reset on page load / module re-import.
let cachedAesKey: CryptoKey | null = null;
let cachedPublicKey: CryptoKey | null = null;

// ── AES-GCM key management ─────────────────────────────────────────────────

/** Returns true if this browser has AES key stored (i.e. credentials were configured here). */
export function hasStoredCredentials(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(AES_KEY_STORAGE) !== null;
  } catch {
    return false;
  }
}

/** Loads the AES key from localStorage; returns null if absent or corrupted. */
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

/** Generates a fresh AES-256-GCM key and persists it to localStorage. */
async function generateAndStoreAesKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,  // extractable so we can export to localStorage
    ['encrypt', 'decrypt'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', key);
  localStorage.setItem(AES_KEY_STORAGE, JSON.stringify(jwk));
  cachedAesKey = key;
  return key;
}

/**
 * Saves or clears the user's Claude Code credentials.json.
 *
 * When setting credentials:
 *   1. Generates a fresh AES-256-GCM key and stores it in localStorage.
 *   2. Encrypts the credentials JSON string with AES-GCM (random IV).
 *   3. POSTs the ciphertext + IV to the server for persistent storage.
 *
 * When clearing (credentials === null):
 *   1. Removes the AES key from localStorage.
 *   2. DELETEs the ciphertext from the server.
 */
export async function setStoredCredentials(credentials: string | null): Promise<void> {
  if (typeof window === 'undefined') return;

  if (credentials === null || credentials === '') {
    cachedAesKey = null;
    localStorage.removeItem(AES_KEY_STORAGE);
    try {
      await fetch(withBasePath('/api/llm-key/encrypted-credentials'), { method: 'DELETE' });
    } catch {
      // Best-effort — local key is already cleared
    }
    return;
  }

  const aesKey = await generateAndStoreAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(credentials),
  );

  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

  const res = await fetch(withBasePath('/api/llm-key/encrypted-credentials'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ iv: ivB64, ciphertext: ctB64 }),
  });
  if (!res.ok) {
    // Roll back: remove the AES key so the client isn't in a broken state
    cachedAesKey = null;
    localStorage.removeItem(AES_KEY_STORAGE);
    throw new Error(`Failed to store encrypted credentials on server: ${res.statusText}`);
  }
}

// ── RSA-OAEP public key cache ──────────────────────────────────────────────

/** Invalidates the cached RSA public key so it is re-fetched on next use. */
export function bustCredentialsPublicKeyCache(): void {
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

/**
 * Returns the credentials JSON ready for secure transmission using hybrid
 * encryption (because credentials.json can exceed RSA-OAEP's plaintext limit):
 *
 *   1. Loads the AES key from localStorage.
 *   2. Fetches + decrypts the AES-encrypted ciphertext from the server.
 *   3. Generates a fresh ephemeral AES-256-GCM key.
 *   4. Encrypts the plaintext credentials with the ephemeral key.
 *   5. Encrypts the ephemeral AES key with the server's RSA-OAEP public key.
 *
 * Returns null if no credentials are configured on this device or any step fails.
 * The plaintext credentials exist only as a transient ArrayBuffer in memory.
 *
 * The returned object shape:
 *   { wrappedKey: string, iv: string, ciphertext: string }
 * All values are base64-encoded. The server decrypts wrappedKey with its RSA
 * private key to recover the ephemeral AES key, then decrypts the ciphertext.
 */
export async function encryptStoredCredentials(): Promise<{
  wrappedKey: string;
  iv: string;
  ciphertext: string;
} | null> {
  try {
    const aesKey = await loadAesKey();
    if (!aesKey) return null;

    const res = await fetch(withBasePath('/api/llm-key/encrypted-credentials'));
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

    // Generate an ephemeral AES key for hybrid encryption
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

    // Wrap the ephemeral AES key with RSA-OAEP (fits: 32 bytes << 190-byte limit)
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
    console.error('[credentials-client] Failed to encrypt credentials:', err);
    return null;
  }
}
