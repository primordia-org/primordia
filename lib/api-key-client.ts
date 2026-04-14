"use client";

// lib/api-key-client.ts
// Client-side helpers for storing the user's Anthropic API key in localStorage
// and encrypting it before sending to the server.
//
// The key is stored as plaintext in localStorage (it is the user's own data on
// their own device). It is encrypted with RSA-OAEP just before every request
// so that the plaintext key is never transmitted or logged.
//
// The server's ephemeral public key is fetched fresh before each request
// (no long-term caching) so that a server restart is handled transparently.

import { withBasePath } from './base-path';

const LOCAL_STORAGE_KEY = 'primordia_anthropic_api_key';

// Module-level cache: reset on page load (or module re-import).
// This avoids refetching on every keystroke in chat, but resets after a
// server restart because the public key JWK changes.
let cachedPublicKey: CryptoKey | null = null;

/** Returns the API key stored in localStorage, or null if none is set. */
export function getStoredApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Saves or clears the API key in localStorage. Pass null to remove it. */
export function setStoredApiKey(key: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (key === null || key === '') {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } else {
      localStorage.setItem(LOCAL_STORAGE_KEY, key);
    }
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded, etc.)
  }
}

/** Invalidates the cached public key so the next call to encryptApiKey()
 *  re-fetches it from the server. Call this after a decryption error. */
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
    false,   // not extractable on the client
    ['encrypt'],
  );
  cachedPublicKey = key;
  return key;
}

/**
 * Encrypts the user's stored API key with the server's RSA-OAEP public key.
 *
 * Returns a base64-encoded ciphertext string ready to include in request
 * bodies. Returns null if no key is stored or encryption fails.
 */
export async function encryptStoredApiKey(): Promise<string | null> {
  const apiKey = getStoredApiKey();
  if (!apiKey) return null;

  try {
    const publicKey = await fetchPublicKey();
    const encoded = new TextEncoder().encode(apiKey);
    const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, encoded);
    return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  } catch (err) {
    console.error('[api-key-client] Failed to encrypt API key:', err);
    return null;
  }
}
