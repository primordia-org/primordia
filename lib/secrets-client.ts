"use client";

// Unified client-side helpers for storing and encrypting user secrets
// (API keys and Claude/ChatGPT subscription credentials).
//
// Architecture:
//   - ONE local user secret is stored in localStorage under `primordia_aes_key`.
//     Despite the historic name, new values are opaque seed material, not a
//     reusable AES key.
//   - For each billing/auth source, the seed is expanded with PBKDF2 using the
//     auth-source identifier as part of the salt. That produces deterministic,
//     source-specific WebCrypto key material:
//       • X25519 keypair for Diffie-Hellman with that credential row's server key
//       • Ed25519 keypair for signing server-issued nonces
//   - Each SQLite credential row has its own server X25519 keypair. Stored
//     ciphertext is encrypted with AES-GCM using SHA-256(X25519 shared secret).
//   - Evolve requests never decrypt-and-resend plaintext credentials. The
//     browser sends a signed nonce proof (`CredentialProof`); the server verifies
//     it, derives `PRIMORDIA_DECRYPTION_KEY`, and workers read/decrypt SQLite.
//   - WebCrypto X25519/Ed25519 is required. There is intentionally no fallback;
//     unsupported browsers fail loudly so there is one credential path only.
//   - Legacy localStorage AES JWKs are treated as seed material and rewritten to
//     the new versioned seed shape. Old top-level ciphertexts are left in SQLite
//     for rollback compatibility when newer versioned payloads are added.

import { withBasePath } from './base-path';
import {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64Url,
  isUserSecretMaterial,
  SECRET_DERIVATION_PBKDF_ITERATIONS,
  SECRET_KEY_VERSION,
  selectCurrentSecretPayload,
  USER_SECRET_STORAGE,
  type CredentialProof,
  type StoredSecretPayload,
  type UserSecretMaterial,
} from './secret-derivation-shared';
import type { SecretAuthSource } from './presets';

export type { SecretAuthSource } from './presets';

const AES_KEY_STORAGE = USER_SECRET_STORAGE;
const LEGACY_CREDENTIALS_AES_KEY_STORAGE = 'primordia_credentials_aes_key';

export type HybridEncryptedSecret = {
  wrappedKey: string;
  iv: string;
  ciphertext: string;
};

const cachedAesKeysBySourceAndServer = new Map<string, CryptoKey>();

function clearLegacyAesKey(): void {
  try { localStorage.removeItem(LEGACY_CREDENTIALS_AES_KEY_STORAGE); } catch {}
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// WebCrypto can generate X25519/Ed25519 keys but does not expose a direct
// "import raw seed as private key" API. PKCS#8 with the RFC 8410 algorithm OID
// is the standard import wrapper for a 32-byte private seed.
const X25519_PKCS8_PREFIX = '302e020100300506032b656e04220420';
const ED25519_PKCS8_PREFIX = '302e020100300506032b657004220420';

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function seedFromStoredLocalSecret(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  if (isUserSecretMaterial(value)) return value.seed;
  const record = value as Record<string, unknown>;
  if (typeof record.k === 'string') return record.k; // legacy AES-GCM JWK material
  const privateKey = record.privateKey as Record<string, unknown> | undefined;
  if (typeof privateKey?.d === 'string') return privateKey.d; // previous migration material
  return null;
}

async function getOrCreateUserSecret(): Promise<UserSecretMaterial> {
  if (typeof window === 'undefined') throw new Error('localStorage unavailable');
  clearLegacyAesKey();
  const raw = localStorage.getItem(AES_KEY_STORAGE);
  if (raw) {
    const seed = seedFromStoredLocalSecret(JSON.parse(raw) as unknown);
    if (seed) {
      const material: UserSecretMaterial = { version: SECRET_KEY_VERSION, seed };
      localStorage.setItem(AES_KEY_STORAGE, JSON.stringify(material));
      return material;
    }
  }
  const seed = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const material: UserSecretMaterial = { version: SECRET_KEY_VERSION, seed };
  localStorage.setItem(AES_KEY_STORAGE, JSON.stringify(material));
  return material;
}

async function fetchServerEcdh(source: SecretAuthSource): Promise<{ publicKey: JsonWebKey; nonce?: string }> {
  const res = await fetch(withBasePath(`/api/secrets/${source}/server-public-key`));
  if (!res.ok) throw new Error(`Failed to fetch credential server key: ${res.statusText}`);
  return (await res.json()) as { publicKey: JsonWebKey; nonce?: string };
}

async function deriveSourceSeed(source: SecretAuthSource, purpose: 'x25519' | 'ed25519'): Promise<Uint8Array> {
  const material = await getOrCreateUserSecret();
  const key = await crypto.subtle.importKey('raw', asBufferSource(base64UrlToBytes(material.seed)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(`primordia:${SECRET_KEY_VERSION}:${source}:${purpose}`),
    iterations: SECRET_DERIVATION_PBKDF_ITERATIONS,
  }, key, 256);
  return new Uint8Array(bits);
}

async function importDeterministicPrivateKey(source: SecretAuthSource, purpose: 'x25519' | 'ed25519'): Promise<CryptoKey> {
  const seed = await deriveSourceSeed(source, purpose);
  const prefix = purpose === 'x25519' ? X25519_PKCS8_PREFIX : ED25519_PKCS8_PREFIX;
  return crypto.subtle.importKey(
    'pkcs8',
    asBufferSource(concatBytes(hexToBytes(prefix), seed)),
    { name: purpose === 'x25519' ? 'X25519' : 'Ed25519' },
    true,
    purpose === 'x25519' ? ['deriveBits'] : ['sign'],
  );
}

async function deriveSourceKeyMaterial(source: SecretAuthSource, serverPublicKey: JsonWebKey): Promise<{ aesKey: CryptoKey; publicKey: JsonWebKey; decryptionKey: string }> {
  const privateKey = await importDeterministicPrivateKey(source, 'x25519');
  const publicKey = await crypto.subtle.importKey('jwk', serverPublicKey, { name: 'X25519' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256);
  const domain = new TextEncoder().encode('primordia-secret-encryption-v1');
  const sharedBytes = new Uint8Array(shared);
  const digestInput = new Uint8Array(domain.length + sharedBytes.length);
  digestInput.set(domain);
  digestInput.set(sharedBytes, domain.length);
  const rawKey = new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput));
  const decryptionKey = bytesToBase64Url(rawKey);
  const cacheKey = `${source}:${JSON.stringify(serverPublicKey)}`;
  let aesKey = cachedAesKeysBySourceAndServer.get(cacheKey);
  if (!aesKey) {
    aesKey = await crypto.subtle.importKey('raw', asBufferSource(rawKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    cachedAesKeysBySourceAndServer.set(cacheKey, aesKey);
  }
  const privateJwk = await crypto.subtle.exportKey('jwk', privateKey);
  return { aesKey, publicKey: { kty: 'OKP', crv: 'X25519', x: privateJwk.x }, decryptionKey };
}

async function signNonce(source: SecretAuthSource, nonce: string, publicKey: JsonWebKey): Promise<{ signature: string; signingPublicKey: JsonWebKey }> {
  const privateKey = await importDeterministicPrivateKey(source, 'ed25519');
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(`${source}:${nonce}:${publicKey.x ?? ''}`),
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', privateKey);
  return { signature: bytesToBase64Url(new Uint8Array(signature)), signingPublicKey: { kty: 'OKP', crv: 'Ed25519', x: privateJwk.x } };
}

async function encryptPayload(source: SecretAuthSource, value: string | ArrayBuffer): Promise<StoredSecretPayload> {
  const { publicKey: serverPublicKey } = await fetchServerEcdh(source);
  const { aesKey } = await deriveSourceKeyMaterial(source, serverPublicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext);
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    keyVersion: SECRET_KEY_VERSION,
    authSource: source,
    serverPublicKey,
  };
}

export async function getCredentialProofForServer(source: SecretAuthSource): Promise<CredentialProof | null> {
  try {
    const { publicKey: serverPublicKey, nonce } = await fetchServerEcdh(source);
    if (!nonce) return null;
    const { publicKey } = await deriveSourceKeyMaterial(source, serverPublicKey);
    return { secretPublicKey: publicKey, nonce, ...(await signNonce(source, nonce, publicKey)) };
  } catch {
    return null;
  }
}

/** No-op: kept for backward compatibility. */
export function bustPublicKeyCache(): void {}

async function fetchPublicKey(): Promise<CryptoKey> {
  const res = await fetch(withBasePath('/api/credential-encryption/public-key'));
  if (!res.ok) throw new Error(`Failed to fetch server public key: ${res.statusText}`);
  const data = (await res.json()) as { publicKey: JsonWebKey };
  return crypto.subtle.importKey('jwk', data.publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
}

/**
 * Encrypts and stores a secret server-side.
 * Generates the local seed if this is the first secret set on this device.
 */
export async function setSecret(source: SecretAuthSource, value: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const payload = await encryptPayload(source, value);
  const res = await fetch(withBasePath(`/api/secrets/${source}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to store ${source} on server: ${res.statusText}`);
}

/**
 * Re-encrypts a refreshed secret (for example an OAuth token refresh) using
 * the same source-specific derived key. The local seed remains stable.
 */
export async function updateSecret(source: SecretAuthSource, value: string): Promise<void> {
  return setSecret(source, value);
}

/**
 * Removes one encrypted secret from the server. If no secrets remain, also
 * removes the local seed so a future setup starts cleanly.
 */
export async function clearSecret(source: SecretAuthSource): Promise<void> {
  if (typeof window === 'undefined') return;
  try { await fetch(withBasePath(`/api/secrets/${source}`), { method: 'DELETE' }); } catch {}
  try {
    const res = await fetch(withBasePath('/api/secrets'));
    if (res.ok && ((await res.json()) as { sources: SecretAuthSource[] }).sources.length === 0) {
      cachedAesKeysBySourceAndServer.clear();
      localStorage.removeItem(AES_KEY_STORAGE);
      clearLegacyAesKey();
    }
  } catch {}
}

export function clearOrphanedSecretsKey(): void {
  if (typeof window === 'undefined') return;
  try {
    cachedAesKeysBySourceAndServer.clear();
    localStorage.removeItem(AES_KEY_STORAGE);
    clearLegacyAesKey();
  } catch {}
}

/**
 * Called after cross-device QR sync. The transferred value may be a current
 * seed object or a legacy AES JWK; normalize it to the current seed format.
 */
export async function adoptNewAesKey(newKeyJwkStr: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const seed = seedFromStoredLocalSecret(JSON.parse(newKeyJwkStr) as unknown);
    if (seed) localStorage.setItem(AES_KEY_STORAGE, JSON.stringify({ version: SECRET_KEY_VERSION, seed } satisfies UserSecretMaterial));
    else localStorage.setItem(AES_KEY_STORAGE, newKeyJwkStr);
    cachedAesKeysBySourceAndServer.clear();
    clearLegacyAesKey();
  } catch {
    localStorage.setItem(AES_KEY_STORAGE, newKeyJwkStr);
  }
}

async function decryptPayloadWithSource(source: SecretAuthSource, ciphertextPayload: string): Promise<string | null> {
  const stored = JSON.parse(ciphertextPayload) as StoredSecretPayload;
  const payload = selectCurrentSecretPayload(stored);
  if (!payload?.serverPublicKey) return null;
  const { aesKey } = await deriveSourceKeyMaterial(source, payload.serverPublicKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asBufferSource(base64ToBytes(payload.iv)) },
    aesKey,
    asBufferSource(base64ToBytes(payload.ciphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * Decrypts and returns the plaintext value of a stored secret for display or
 * local refresh flows. Returns null if ciphertext/key material is unavailable.
 */
export async function getSecret(source: SecretAuthSource): Promise<string | null> {
  try {
    const res = await fetch(withBasePath(`/api/secrets/${source}`));
    if (!res.ok) return null;
    const data = (await res.json()) as { ciphertext: string | null };
    return data.ciphertext ? decryptPayloadWithSource(source, data.ciphertext) : null;
  } catch {
    return null;
  }
}

export async function decryptStoredSecretPayload(ciphertextPayload: string | null | undefined): Promise<string | null> {
  try {
    if (!ciphertextPayload) return null;
    const source = (JSON.parse(ciphertextPayload) as StoredSecretPayload).authSource;
    return source ? decryptPayloadWithSource(source, ciphertextPayload) : null;
  } catch {
    return null;
  }
}

export async function encryptSecretForTransmission(source: SecretAuthSource): Promise<HybridEncryptedSecret | null> {
  try {
    const plaintextString = await getSecret(source);
    if (!plaintextString) return null;
    const ephemeralKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const ephemeralIv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedPayload = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ephemeralIv }, ephemeralKey, new TextEncoder().encode(plaintextString));
    const publicKey = await fetchPublicKey();
    const ephemeralKeyRaw = await crypto.subtle.exportKey('raw', ephemeralKey);
    const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, ephemeralKeyRaw);
    return {
      wrappedKey: bytesToBase64(new Uint8Array(wrappedKey)),
      iv: bytesToBase64(ephemeralIv),
      ciphertext: bytesToBase64(new Uint8Array(encryptedPayload)),
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
