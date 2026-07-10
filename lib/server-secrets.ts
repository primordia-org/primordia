// lib/server-secrets.ts
// Server-side helpers for decrypting user secrets stored as AES-GCM blobs in SQLite.

import { getDb } from './db';
import { isSecretAuthSource, type SecretAuthSource } from './presets';

interface StoredSecretPayload {
  iv: string;
  ciphertext: string;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const buffer = Buffer.from(value, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function normalizeAesKeyJwk(raw: string): JsonWebKey {
  const parsed = JSON.parse(raw) as JsonWebKey;
  if (parsed.kty !== 'oct' || typeof parsed.k !== 'string') {
    throw new Error('Invalid Primordia AES key');
  }
  return parsed;
}

export async function decryptStoredSecretPayload(ciphertextJson: string, aesKeyJwkJson: string): Promise<string> {
  const payload = JSON.parse(ciphertextJson) as StoredSecretPayload;
  if (!payload || typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') {
    throw new Error('Invalid stored secret payload');
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    normalizeAesKeyJwk(aesKeyJwkJson),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToArrayBuffer(payload.iv) },
    key,
    base64ToArrayBuffer(payload.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
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
