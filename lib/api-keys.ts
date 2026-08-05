// lib/api-keys.ts
// Revokable AES wrapper API keys used by Primordia CLI and Core clients.

import { getDb } from './db';
import type { RevokableAesKey } from './db/types';

export const API_KEY_PREFIX = 'v1';

export interface ParsedApiKey {
  version: string;
  shortId: string;
  alg: string;
  k: string;
}

export interface ResolvedPrimordiaApiKey {
  user: { id: string; username: string };
  aesKeyJwkJson: string;
  record: RevokableAesKey;
}

export function parsePrimordiaApiKey(value: string): ParsedApiKey {
  const parts = value.trim().split('.');
  if (parts.length !== 4 || parts[0] !== API_KEY_PREFIX || !parts[1] || !parts[2] || !parts[3]) {
    throw new Error('Invalid PRIMORDIA_API_KEY format. Expected v1.<short-id>.<alg>.<k>.');
  }
  return { version: parts[0], shortId: parts[1], alg: parts[2], k: parts[3] };
}

export async function decryptWrappedAesKey(encryptedAesKey: string, wrapperJwk: JsonWebKey): Promise<string> {
  const payload = JSON.parse(encryptedAesKey) as { iv?: string; ciphertext?: string };
  if (typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') {
    throw new Error('Stored API key payload is invalid.');
  }
  const key = await crypto.subtle.importKey('jwk', wrapperJwk, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.fromBase64(payload.iv) },
    key,
    Uint8Array.fromBase64(payload.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export async function resolvePrimordiaApiKey(value: string, expectedClient?: 'cli' | 'web'): Promise<ResolvedPrimordiaApiKey> {
  const parsed = parsePrimordiaApiKey(value);
  const db = await getDb();
  const record = await db.getRevokableAesKey(parsed.shortId);
  if (!record) throw new Error('PRIMORDIA_API_KEY was not found. Create a new API key in Settings → API keys.');
  if (record.revokedAt !== null) throw new Error('PRIMORDIA_API_KEY has been revoked. Create a new API key in Settings → API keys and update this shell.');
  if (record.version !== parsed.version) throw new Error('PRIMORDIA_API_KEY version does not match the stored key.');
  if (expectedClient && record.client !== expectedClient) throw new Error(`Primordia API key is restricted to ${record.client} clients.`);
  if (record.expiresAt <= Date.now()) throw new Error('PRIMORDIA_API_KEY has expired. Extend it or create a new key in Settings → API keys.');

  const wrapperJwk: JsonWebKey = {
    kty: 'oct',
    alg: parsed.alg,
    k: parsed.k,
    ext: true,
    key_ops: ['decrypt'],
  };
  const [aesKeyJwkJson, user] = await Promise.all([
    decryptWrappedAesKey(record.encryptedAesKey, wrapperJwk),
    db.getUserById(record.userId),
  ]);
  if (!user) throw new Error('Primordia API key refers to a user that no longer exists.');
  return { user, aesKeyJwkJson, record };
}

export function publicRevokableAesKey(record: RevokableAesKey) {
  return {
    shortId: record.shortId,
    version: record.version,
    client: record.client,
    scopes: record.scopes,
    note: record.note,
    expiresAt: record.expiresAt,
    signature: record.signature,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
  };
}
