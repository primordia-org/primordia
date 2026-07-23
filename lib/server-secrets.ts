// lib/server-secrets.ts
// Server-side helpers for decrypting user secrets stored as AES-GCM blobs in SQLite.

import { getDb } from './db';
import { isSecretAuthSource, type SecretAuthSource } from './presets';

interface StoredSecretPayload {
  iv: string;
  ciphertext: string;
}

function normalizeAesKeyJwk(raw: string): JsonWebKey {
  const parsed = JSON.parse(raw) as JsonWebKey;
  if (parsed.kty !== 'oct' || typeof parsed.k !== 'string') {
    throw new Error('Invalid Primordia AES key');
  }
  return parsed;
}

async function importStoredSecretAesKey(aesKeyJwkJson: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    normalizeAesKeyJwk(aesKeyJwkJson),
    { name: 'AES-GCM' },
    false,
    usages,
  );
}

export async function decryptStoredSecretPayload(ciphertextJson: string, aesKeyJwkJson: string): Promise<string> {
  const payload = JSON.parse(ciphertextJson) as StoredSecretPayload;
  if (!payload || typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') {
    throw new Error('Invalid stored secret payload');
  }

  const key = await importStoredSecretAesKey(aesKeyJwkJson, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.fromBase64(payload.iv) },
    key,
    Uint8Array.fromBase64(payload.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export async function encryptStoredSecretPayload(plaintext: string, aesKeyJwkJson: string): Promise<string> {
  const key = await importStoredSecretAesKey(aesKeyJwkJson, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return JSON.stringify({
    iv: iv.toBase64(),
    ciphertext: new Uint8Array(ciphertext).toBase64(),
  });
}

export async function getEncryptedSecretForUser(userId: string, source: string | null | undefined): Promise<string | null> {
  if (!source || !isSecretAuthSource(source)) return null;
  const db = await getDb();
  const stored = await db.getEncryptedCredential(userId, source);
  return stored && stored.length > 0 ? stored : null;
}

export async function decryptStoredSecretForUser(userId: string, source: SecretAuthSource, aesKeyJwkJson: string): Promise<string | null> {
  const stored = await getEncryptedSecretForUser(userId, source);
  if (!stored) return null;
  return decryptStoredSecretPayload(stored, aesKeyJwkJson);
}

export async function storeEncryptedSecretForUser(userId: string, source: SecretAuthSource, plaintext: string, aesKeyJwkJson: string): Promise<void> {
  const db = await getDb();
  await db.setEncryptedCredential(userId, source, await encryptStoredSecretPayload(plaintext, aesKeyJwkJson));
}
