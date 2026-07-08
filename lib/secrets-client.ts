"use client";

// lib/secrets-client.ts
// Unified client-side helpers for storing and encrypting user secrets
// (API keys and Claude Code credentials).
//
// Architecture:
//   - ONE user secret per browser stored in localStorage ('primordia_aes_key').
//     New installs store a P-256 ECDH keypair there. The browser combines that
//     private key with the server public key to derive the AES-GCM key used for
//     all secret sources.
//   - The server combines its private key with the browser public key to derive
//     the same raw PRIMORDIA_DECRYPTION_KEY. Evolve requests can therefore pass
//     only the local public key; the server/worker decrypts the selected DB
//     ciphertext without round-tripping plaintext through the browser.
//   - Legacy localStorage AES keys are migrated to the ECDH format in-place.
//     The migration adds a versioned ECDH payload while keeping the previous
//     top-level ciphertext so rollbacks can still decrypt old saves.

import { withBasePath } from './base-path';
import { isUserSecretMaterial, SECRET_KEY_VERSION, selectCurrentSecretPayload, USER_SECRET_STORAGE, type StoredSecretPayload, type UserSecretMaterial } from './secret-derivation-shared';
import type { SecretAuthSource } from './presets';

export type { SecretAuthSource } from './presets';

const AES_KEY_STORAGE = USER_SECRET_STORAGE;
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

// Module-level cache for the user's derived AES key — reset on page load / module re-import.
let cachedAesKey: CryptoKey | null = null;
let cachedSecretPublicKey: JsonWebKey | null = null;

// ── AES-GCM key management ──────────────────────────────────────────────────

async function fetchServerEcdhPublicKey(): Promise<CryptoKey> {
  const res = await fetch(withBasePath('/api/credential-encryption/server-public-key'));
  if (!res.ok) throw new Error(`Failed to fetch server ECDH public key: ${res.statusText}`);
  const data = (await res.json()) as { publicKey: JsonWebKey };
  return crypto.subtle.importKey('jwk', data.publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function importUserSecretPrivateKey(material: { privateKey: JsonWebKey }): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', material.privateKey, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

async function deriveAesKey(material: { privateKey: JsonWebKey; publicKey: JsonWebKey }): Promise<CryptoKey> {
  const privateKey = await importUserSecretPrivateKey(material);
  const serverPublicKey = await fetchServerEcdhPublicKey();
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: serverPublicKey }, privateKey, 256);
  const domain = new TextEncoder().encode('primordia-secret-encryption-v1');
  const digestInput = new Uint8Array(domain.length + sharedBits.byteLength);
  digestInput.set(domain);
  digestInput.set(new Uint8Array(sharedBits), domain.length);
  const rawKey = await crypto.subtle.digest('SHA-256', digestInput);
  cachedSecretPublicKey = material.publicKey;
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptPayload(aesKey: CryptoKey, value: string | ArrayBuffer): Promise<{ iv: string; ciphertext: string; keyVersion: typeof SECRET_KEY_VERSION }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext);
  return {
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    keyVersion: SECRET_KEY_VERSION,
  };
}

async function migrateLegacyAesSecret(legacyJwk: JsonWebKey): Promise<CryptoKey> {
  const legacyKey = await crypto.subtle.importKey('jwk', legacyJwk, { name: 'AES-GCM' }, false, ['decrypt']);
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const material: UserSecretMaterial = {
    version: SECRET_KEY_VERSION,
    privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey),
    publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
  };
  const newKey = await deriveAesKey(material);

  let sources: SecretAuthSource[] = [];
  try {
    const listRes = await fetch(withBasePath('/api/secrets'));
    if (listRes.ok) sources = ((await listRes.json()) as { sources: SecretAuthSource[] }).sources;
  } catch {}

  for (const source of sources) {
    try {
      const res = await fetch(withBasePath(`/api/secrets/${source}`));
      if (!res.ok) continue;
      const data = (await res.json()) as { ciphertext: string | null };
      if (!data.ciphertext) continue;
      const stored = JSON.parse(data.ciphertext) as StoredSecretPayload;
      if (selectCurrentSecretPayload(stored)) continue;
      const iv = Uint8Array.from(atob(stored.iv), (c) => c.charCodeAt(0));
      const ct = Uint8Array.from(atob(stored.ciphertext), (c) => c.charCodeAt(0));
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, ct);
      const migrated = await encryptPayload(newKey, plaintext);
      await fetch(withBasePath(`/api/secrets/${source}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...stored,
          versions: { ...(stored.versions ?? {}), [SECRET_KEY_VERSION]: migrated },
        }),
      });
    } catch {
      // Leave the legacy ciphertext untouched; the user can reconnect this source.
    }
  }

  localStorage.setItem(AES_KEY_STORAGE, JSON.stringify(material));
  clearLegacyAesKey();
  return newKey;
}

async function loadAesKey(): Promise<CryptoKey | null> {
  if (cachedAesKey) return cachedAesKey;
  if (typeof window === 'undefined') return null;
  try {
    clearLegacyAesKey();
    const jwkStr = localStorage.getItem(AES_KEY_STORAGE);
    if (!jwkStr) return null;
    const parsed = JSON.parse(jwkStr) as unknown;
    if (isUserSecretMaterial(parsed)) {
      cachedAesKey = await deriveAesKey(parsed);
      return cachedAesKey;
    }
    // One-time migration: older browsers stored an AES-GCM JWK directly.
    // Convert it to an ECDH user secret and add versioned ciphertexts without
    // deleting the top-level legacy payloads.
    cachedAesKey = await migrateLegacyAesSecret(parsed as JsonWebKey);
    return cachedAesKey;
  } catch {
    return null;
  }
}

async function getOrCreateAesKey(): Promise<CryptoKey> {
  const existing = await loadAesKey();
  if (existing && cachedSecretPublicKey) return existing;
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const material = { version: SECRET_KEY_VERSION, privateKey, publicKey };
  localStorage.setItem(AES_KEY_STORAGE, JSON.stringify(material));
  clearLegacyAesKey();
  cachedAesKey = await deriveAesKey(material);
  return cachedAesKey;
}

export async function getSecretPublicKeyForServer(): Promise<JsonWebKey | null> {
  if (typeof window === 'undefined') return null;
  try {
    await getOrCreateAesKey();
    if (cachedSecretPublicKey) return cachedSecretPublicKey;
    const raw = localStorage.getItem(AES_KEY_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isUserSecretMaterial(parsed) ? parsed.publicKey : null;
  } catch {
    return null;
  }
}

// ── RSA-OAEP public key ─────────────────────────────────────────────────────

/** No-op: kept for backward compatibility. The public key is always fetched fresh. */
export function bustPublicKeyCache(): void {}

async function fetchPublicKey(): Promise<CryptoKey> {
  // Fetch on every transmission instead of reusing a module-level RSA key.
  // Already-open tabs can span a blue/green deploy; a fresh fetch avoids using
  // a stale transport key if the server key ever rotates.
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
  const payload = await encryptPayload(aesKey, value);

  const res = await fetch(withBasePath(`/api/secrets/${source}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
  const aesKey = await getOrCreateAesKey();
  const payload = await encryptPayload(aesKey, value);

  const res = await fetch(withBasePath(`/api/secrets/${source}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

    const payload = selectCurrentSecretPayload(JSON.parse(data.ciphertext) as StoredSecretPayload);
    if (!payload) return null;

    const iv = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(payload.ciphertext), (c) => c.charCodeAt(0));
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

    const payload = selectCurrentSecretPayload(JSON.parse(ciphertextPayload) as StoredSecretPayload);
    if (!payload) return null;

    const iv = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(payload.ciphertext), (c) => c.charCodeAt(0));
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

    const payload = selectCurrentSecretPayload(JSON.parse(data.ciphertext) as StoredSecretPayload);
    if (!payload) return null;

    const iv = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(payload.ciphertext), (c) => c.charCodeAt(0));
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
