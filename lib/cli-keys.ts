// lib/cli-keys.ts
// Revokable AES wrapper keys used by terminal Primordia CLI commands.

import { getDb } from './db';
import type { RevokableAesKey } from './db/types';

export const CLI_KEY_PREFIX = 'v1';
export const CLI_KEY_CLIENT = 'cli' as const;

export interface ParsedCliKey {
  version: string;
  shortId: string;
  alg: string;
  k: string;
}

export interface ResolvedCliKey {
  userId: string;
  aesKeyJwkJson: string;
  record: RevokableAesKey;
}

export function parsePrimordiaCliKey(value: string): ParsedCliKey {
  const parts = value.trim().split('.');
  if (parts.length !== 4 || parts[0] !== CLI_KEY_PREFIX || !parts[1] || !parts[2] || !parts[3]) {
    throw new Error('Invalid PRIMORDIA_CLI_KEY format. Expected v1.<short-id>.<alg>.<k>.');
  }
  return { version: parts[0], shortId: parts[1], alg: parts[2], k: parts[3] };
}

export async function decryptWrappedAesKey(encryptedAesKey: string, wrapperJwk: JsonWebKey): Promise<string> {
  const payload = JSON.parse(encryptedAesKey) as { iv?: string; ciphertext?: string };
  if (typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') {
    throw new Error('Stored CLI key payload is invalid.');
  }
  const key = await crypto.subtle.importKey('jwk', wrapperJwk, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.fromBase64(payload.iv) },
    key,
    Uint8Array.fromBase64(payload.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export async function resolvePrimordiaCliKey(value: string, expectedClient: 'cli' | 'web' = CLI_KEY_CLIENT): Promise<ResolvedCliKey> {
  const parsed = parsePrimordiaCliKey(value);
  const db = await getDb();
  const record = await db.getRevokableAesKey(parsed.shortId);
  if (!record) throw new Error('PRIMORDIA_CLI_KEY was not found or has been revoked. Create a new CLI key in Settings → Primordia CLI.');
  if (record.version !== parsed.version) throw new Error('PRIMORDIA_CLI_KEY version does not match the stored key.');
  if (record.client !== expectedClient) throw new Error(`PRIMORDIA_CLI_KEY is restricted to ${record.client} clients.`);
  if (record.expiresAt <= Date.now()) throw new Error('PRIMORDIA_CLI_KEY has expired. Extend it or create a new key in Settings → Primordia CLI.');

  const wrapperJwk: JsonWebKey = {
    kty: 'oct',
    alg: parsed.alg,
    k: parsed.k,
    ext: true,
    key_ops: ['decrypt'],
  };
  const aesKeyJwkJson = await decryptWrappedAesKey(record.encryptedAesKey, wrapperJwk);
  return { userId: record.userId, aesKeyJwkJson, record };
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
  };
}
