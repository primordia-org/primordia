"use client";

// lib/secrets-client.ts
// Unified client-side helpers for storing and encrypting user secrets
// (API keys and Claude Code credentials).
//
// Architecture:
//   - ONE AES-256-GCM key per user stored in localStorage ('primordia_aes_key').
//     All secret sources share this key — simplifies cross-device AES key sync.
//   - Each secret source is stored server-side in encrypted_credentials by
//     authSource (see /api/secrets/[source]) using AES-GCM with a per-save random IV.
//   - No local presence index — always ask the server whether a secret is set.
//   - For transmission, every secret uses the same hybrid envelope:
//     ephemeral AES-256-GCM encrypts the secret, RSA-OAEP wraps that AES key.
//     This avoids RSA plaintext-size limits and keeps one code path for all
//     credential material.
//
// Key that never leaves the browser: the AES-256-GCM key in localStorage.
// Key that never leaves the server process: the RSA-OAEP private key.

import { withBasePath } from './base-path';
import type { SecretAuthSource } from './presets';

export type { SecretAuthSource } from './presets';

const AES_KEY_STORAGE = 'primordia_aes_key';
const LEGACY_CREDENTIALS_AES_KEY_STORAGE = 'primordia_credentials_aes_key';

function clearLegacyAesKey(): void {
  try {
    localStorage.removeItem(LEGACY_CREDENTIALS_AES_KEY_STORAGE);
  } catch {}
}

export type HybridEncryptedSecret = {
  wrappedKey: string;
  iv: string;
  ciphertext: string;
};

// Module-level caches — reset on page load / module re-import.
let cachedAesKey: CryptoKey | null = null;
let cachedPublicKey: CryptoKey | null = null;

// ── AES-GCM key management ──────────────────────────────────────────────────

async function loadAesKey(): Promise<CryptoKey | null> {
  if (cachedAesKey) return cachedAesKey;
  if (typeof window === 'undefined') return null;
  try {
    clearLegacyAesKey();
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
  clearLegacyAesKey();
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
  const res = await fetch(withBasePath('/api/credential-encryption/public-key'));
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
export async function setSecret(source: SecretAuthSource, value: string): Promise<void> {
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

  const res = await fetch(withBasePath(`/api/secrets/${source}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ iv: ivB64, ciphertext: ctB64 }),
  });
  if (!res.ok) {
    throw new Error(`Failed to store ${source} on server: ${res.statusText}`);
  }
}

/**
 * Re-encrypts a secret using the EXISTING AES key without changing it.
 * Use for server-side refreshes (e.g. OAuth token rotation) where the key
 * must remain stable so other browser contexts can still decrypt.
 * Falls back to setSecret() if no AES key exists yet.
 */
export async function updateSecret(source: SecretAuthSource, value: string): Promise<void> {
  const aesKey = await loadAesKey();
  if (!aesKey) return setSecret(source, value);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(value),
  );

  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

  const res = await fetch(withBasePath(`/api/secrets/${source}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ iv: ivB64, ciphertext: ctB64 }),
  });
  if (!res.ok) throw new Error(`Failed to update ${source} on server: ${res.statusText}`);
}

/**
 * Removes a secret from the server. If this was the last secret stored for
 * this user, also removes the shared AES key from localStorage.
 */
export async function clearSecret(source: SecretAuthSource): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    await fetch(withBasePath(`/api/secrets/${source}`), { method: 'DELETE' });
  } catch {
    // Best-effort — continue to check remaining secrets
  }

  // If no secrets remain on the server, remove the local AES key.
  try {
    const res = await fetch(withBasePath('/api/secrets'));
    if (res.ok) {
      const data = (await res.json()) as { sources: SecretAuthSource[] };
      if (data.sources.length === 0) {
        cachedAesKey = null;
        localStorage.removeItem(AES_KEY_STORAGE);
        clearLegacyAesKey();
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
    clearLegacyAesKey();
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
    clearLegacyAesKey();
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
    clearLegacyAesKey();
    cachedAesKey = null;
    return;
  }

  // Ask the server which sources have ciphertext so we know what to migrate.
  let sources: SecretAuthSource[] = [];
  try {
    const listRes = await fetch(withBasePath('/api/secrets'));
    if (listRes.ok) {
      const data = (await listRes.json()) as { sources: SecretAuthSource[] };
      sources = data.sources;
    }
  } catch {}

  for (const source of sources) {
    try {
      const res = await fetch(withBasePath(`/api/secrets/${source}`));
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

      await fetch(withBasePath(`/api/secrets/${source}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iv: newIvB64, ciphertext: newCtB64 }),
      });
    } catch {
      // Decrypt failed (already uses new key) or network error — skip.
    }
  }

  localStorage.setItem(AES_KEY_STORAGE, newKeyJwkStr);
  clearLegacyAesKey();
  cachedAesKey = null;
}

/**
 * Decrypts and returns the plaintext value of a stored secret.
 * Returns null if no AES key is in localStorage, the type has no ciphertext
 * on the server, or decryption fails for any reason.
 */
export async function getSecret(source: SecretAuthSource): Promise<string | null> {
  try {
    const aesKey = await loadAesKey();
    if (!aesKey) return null;

    const res = await fetch(withBasePath(`/api/secrets/${source}`));
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

    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

export async function decryptStoredSecretPayload(ciphertextPayload: string | null | undefined): Promise<string | null> {
  try {
    if (!ciphertextPayload) return null;

    const aesKey = await loadAesKey();
    if (!aesKey) return null;

    const { iv: ivB64, ciphertext: ctB64 } = JSON.parse(ciphertextPayload) as {
      iv: string;
      ciphertext: string;
    };

    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);

    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/**
 * Returns a stored secret ready for secure transmission using hybrid
 * encryption:
 *   1. Load the shared AES key from localStorage.
 *   2. Fetch + decrypt the AES-encrypted secret from the server.
 *   3. Generate a fresh ephemeral AES key, encrypt the secret with it.
 *   4. Wrap the ephemeral AES key with the server's RSA-OAEP public key.
 *
 * Returns null if no secret is configured on this device or any step fails.
 * The plaintext exists only as a transient ArrayBuffer in memory.
 *
 * Returned shape: { wrappedKey, iv, ciphertext } — all base64-encoded.
 * The server decrypts wrappedKey with its RSA private key to recover the
 * ephemeral AES key, then uses it to decrypt the ciphertext.
 */
export async function encryptSecretForTransmission(source: SecretAuthSource): Promise<HybridEncryptedSecret | null> {
  try {
    const aesKey = await loadAesKey();
    if (!aesKey) return null;

    const res = await fetch(withBasePath(`/api/secrets/${source}`));
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
    console.error(`[secrets-client] Failed to encrypt ${source} for transmission:`, err);
    return null;
  }
}

export async function encryptCredentialsForTransmission(): Promise<HybridEncryptedSecret | null> {
  return encryptSecretForTransmission('claude-subscription');
}

export async function encryptChatGptSubscriptionForTransmission(): Promise<HybridEncryptedSecret | null> {
  return encryptSecretForTransmission('chatgpt-subscription');
}
