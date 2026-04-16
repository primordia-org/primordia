"use client";

// lib/api-key-client.ts
// Client-side helpers for storing and encrypting the user's Anthropic API key.
//
// Architecture:
//   - An AES-256-GCM key is generated in the browser and stored in localStorage.
//     It never leaves the browser.
//   - The API key is encrypted with that AES key and the ciphertext is stored
//     server-side (in user_preferences), bound to the authenticated user.
//   - When an API key is needed for a request, the browser fetches the ciphertext,
//     decrypts it locally with the AES key, then re-encrypts with the server's
//     ephemeral RSA-OAEP public key before sending — so the plaintext key is
//     never transmitted or logged.
//
// Key that never leaves the browser: the AES-256-GCM key in localStorage.
// Key that never leaves the server process: the RSA-OAEP private key.

import { withBasePath } from './base-path';

const AES_KEY_STORAGE = 'primordia_aes_key'; // localStorage: AES-GCM key as JWK

// Module-level caches — reset on page load / module re-import.
let cachedAesKey: CryptoKey | null = null;
let cachedPublicKey: CryptoKey | null = null;

// ── AES-GCM key management ─────────────────────────────────────────────────

/** Returns true if this browser has an AES key stored (i.e. an API key was configured here). */
export function hasStoredApiKey(): boolean {
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
 * Saves or clears the user's Anthropic API key.
 *
 * When setting a key:
 *   1. Generates a fresh AES-256-GCM key and stores it in localStorage.
 *   2. Encrypts the API key with AES-GCM (random IV).
 *   3. POSTs the ciphertext + IV to the server for persistent storage.
 *
 * When clearing (key === null):
 *   1. Removes the AES key from localStorage.
 *   2. DELETEs the ciphertext from the server.
 */
export async function setStoredApiKey(key: string | null): Promise<void> {
  if (typeof window === 'undefined') return;

  if (key === null || key === '') {
    cachedAesKey = null;
    localStorage.removeItem(AES_KEY_STORAGE);
    try {
      await fetch(withBasePath('/api/llm-key/encrypted-key'), { method: 'DELETE' });
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
    new TextEncoder().encode(key),
  );

  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

  const res = await fetch(withBasePath('/api/llm-key/encrypted-key'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ iv: ivB64, ciphertext: ctB64 }),
  });
  if (!res.ok) {
    // Roll back: remove the AES key so the client isn't in a broken state
    cachedAesKey = null;
    localStorage.removeItem(AES_KEY_STORAGE);
    throw new Error(`Failed to store encrypted key on server: ${res.statusText}`);
  }
}

// ── RSA-OAEP in-transit encryption ─────────────────────────────────────────

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

/**
 * Returns the user's API key ready for secure transmission:
 *
 *   1. Loads the AES key from localStorage.
 *   2. Fetches the AES-encrypted ciphertext from the server.
 *   3. Decrypts the ciphertext locally to recover the plaintext API key.
 *   4. Re-encrypts with the server's ephemeral RSA-OAEP public key.
 *
 * Returns null if no key is configured on this device or any step fails.
 * The plaintext key exists only as a transient ArrayBuffer in memory.
 */
export async function encryptStoredApiKey(): Promise<string | null> {
  try {
    const aesKey = await loadAesKey();
    if (!aesKey) return null;

    const res = await fetch(withBasePath('/api/llm-key/encrypted-key'));
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

    // RSA-OAEP encrypt for transmission — plaintext never leaves this scope
    const publicKey = await fetchPublicKey();
    const rsaEncrypted = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      plaintext,
    );
    return btoa(String.fromCharCode(...new Uint8Array(rsaEncrypted)));
  } catch (err) {
    console.error('[api-key-client] Failed to encrypt API key:', err);
    return null;
  }
}
