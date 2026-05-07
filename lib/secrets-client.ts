"use client";

// lib/secrets-client.ts
// Unified client-side helpers for storing and encrypting user secrets
// (API keys and Claude Code credentials).
//
// Architecture:
//   - ONE AES-256-GCM key per user stored in localStorage ('primordia_aes_key').
//     All secret types share this key — simplifies cross-device AES key sync.
//   - Each secret type is stored server-side under its own preference key
//     (see SERVER_PREF_KEYS) using AES-GCM with a per-save random IV.
//   - A secrets presence index ('primordia_secrets') tracks which types are
//     configured on this device, enabling synchronous hasSecret() checks.
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
const SECRETS_INDEX_STORAGE = 'primordia_secrets';

// Module-level caches — reset on page load / module re-import.
let cachedAesKey: CryptoKey | null = null;
let cachedPublicKey: CryptoKey | null = null;

// ── Secrets presence index ──────────────────────────────────────────────────

function readSecretsIndex(): SecretType[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SECRETS_INDEX_STORAGE);
    if (raw !== null) return JSON.parse(raw) as SecretType[];
    // Backward compat: if the old Anthropic AES key is present but no index
    // exists yet, seed the index — the original AES key was only ever used for
    // the Anthropic API key before the unified secrets architecture was added.
    if (localStorage.getItem(AES_KEY_STORAGE) !== null) return ['ANTHROPIC_API_KEY'];
    return [];
  } catch {
    return [];
  }
}

function writeSecretsIndex(types: SecretType[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SECRETS_INDEX_STORAGE, JSON.stringify(types));
  } catch {}
}

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

/** Returns true if this device has a stored value for the given secret type. Synchronous. */
export function hasSecret(type: SecretType): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return readSecretsIndex().includes(type);
  } catch {
    return false;
  }
}

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

  const current = readSecretsIndex();
  if (!current.includes(type)) writeSecretsIndex([...current, type]);
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

  const current = readSecretsIndex();
  if (!current.includes(type)) writeSecretsIndex([...current, type]);
}

/**
 * Removes a secret from the server and updates the local presence index.
 * If this was the last secret, also removes the shared AES key from localStorage.
 */
export async function clearSecret(type: SecretType): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    await fetch(withBasePath(`/api/secrets/${type}`), { method: 'DELETE' });
  } catch {
    // Best-effort — continue to update local state
  }

  const remaining = readSecretsIndex().filter((t) => t !== type);
  if (remaining.length === 0) {
    cachedAesKey = null;
    localStorage.removeItem(AES_KEY_STORAGE);
    localStorage.removeItem(SECRETS_INDEX_STORAGE);
  } else {
    writeSecretsIndex(remaining);
  }
}

/**
 * Removes the local AES key and secrets index without touching the server.
 * Use when the server has no ciphertext (orphaned local state) to resync
 * the two sides without issuing a DELETE.
 */
export function clearOrphanedSecretsKey(): void {
  if (typeof window === 'undefined') return;
  try {
    cachedAesKey = null;
    localStorage.removeItem(AES_KEY_STORAGE);
    localStorage.removeItem(SECRETS_INDEX_STORAGE);
  } catch {}
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
