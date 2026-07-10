// lib/worker-secret-env.ts
// Synchronous worker-side AES-GCM decryption for secrets stored by lib/secrets-client.

import { createDecipheriv } from 'crypto';

interface StoredSecretPayload {
  iv: string;
  ciphertext: string;
}

interface DecryptedWorkerSecret {
  apiKey?: string;
  credentials?: string;
  chatGptOAuth?: string;
}

export function decryptWorkerSecret(encryptedSecret: string | undefined, aesKeyJwkJson: string | undefined, authSource: string | null | undefined): DecryptedWorkerSecret {
  if (!encryptedSecret || !aesKeyJwkJson || !authSource || authSource === 'exe-dev-gateway') return {};

  const jwk = JSON.parse(aesKeyJwkJson) as JsonWebKey;
  if (jwk.kty !== 'oct' || typeof jwk.k !== 'string') throw new Error('Invalid PRIMORDIA_AES_KEY');

  const payload = JSON.parse(encryptedSecret) as StoredSecretPayload;
  const encrypted = Uint8Array.fromBase64(payload.ciphertext);
  const iv = Uint8Array.fromBase64(payload.iv);
  const key = Uint8Array.fromBase64(jwk.k, { alphabet: 'base64url' });
  const authTag = encrypted.subarray(encrypted.length - 16);
  const body = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');

  if (authSource === 'claude-subscription') return { credentials: plaintext };
  if (authSource === 'chatgpt-subscription') return { chatGptOAuth: plaintext };
  return { apiKey: plaintext };
}
