// Server-side half of Primordia secret key derivation.
//
// The browser keeps a per-user ECDH private key in localStorage. The server keeps
// one instance ECDH private key on disk (or PRIMORDIA_SERVER_SECRET). Both sides
// derive the same AES-256-GCM key via ECDH + SHA-256. The derived raw key is the
// PRIMORDIA_DECRYPTION_KEY passed to detached workers.

import fs from 'fs';
import path from 'path';
import { createHash, createPrivateKey, createPublicKey, diffieHellman, webcrypto, type JsonWebKey as NodeJsonWebKey } from 'crypto';
import { base64ToBytes, bytesToBase64, SECRET_KEY_VERSION, selectCurrentSecretPayload, type StoredSecretPayload } from '@/lib/secret-derivation-shared';

const SECRET_FILE = '.primordia-server-ecdh-secret.json';
const subtle = webcrypto.subtle;

function secretFilePath(): string {
  const root = process.env.PRIMORDIA_DIR || process.cwd();
  return path.join(root, SECRET_FILE);
}

async function generateServerSecret(): Promise<JsonWebKey> {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return await subtle.exportKey('jwk', pair.privateKey);
}

let cachedPrivateJwk: JsonWebKey | null = null;

export async function getServerPrivateJwk(): Promise<JsonWebKey> {
  if (cachedPrivateJwk) return cachedPrivateJwk;

  const fromEnv = process.env.PRIMORDIA_SERVER_SECRET;
  if (fromEnv) {
    cachedPrivateJwk = JSON.parse(Buffer.from(fromEnv, 'base64url').toString('utf8')) as JsonWebKey;
    return cachedPrivateJwk;
  }

  const file = secretFilePath();
  try {
    cachedPrivateJwk = JSON.parse(fs.readFileSync(file, 'utf8')) as JsonWebKey;
    return cachedPrivateJwk;
  } catch {}

  cachedPrivateJwk = await generateServerSecret();
  fs.writeFileSync(file, JSON.stringify(cachedPrivateJwk), { mode: 0o600 });
  return cachedPrivateJwk;
}

export async function getServerPublicJwk(): Promise<JsonWebKey> {
  const privateKey = createPrivateKey({ key: await getServerPrivateJwk() as NodeJsonWebKey, format: 'jwk' });
  return createPublicKey(privateKey).export({ format: 'jwk' }) as JsonWebKey;
}

export async function deriveDecryptionKey(secretPublicKey: JsonWebKey): Promise<string> {
  const privateKey = createPrivateKey({ key: await getServerPrivateJwk() as NodeJsonWebKey, format: 'jwk' });
  const publicKey = createPublicKey({ key: secretPublicKey as NodeJsonWebKey, format: 'jwk' });
  const shared = diffieHellman({ privateKey, publicKey });
  return createHash('sha256').update('primordia-secret-encryption-v1').update(shared).digest('base64url');
}

export async function decryptStoredSecretPayload(payloadJson: string, decryptionKey: string): Promise<string> {
  const payload = selectCurrentSecretPayload(JSON.parse(payloadJson) as StoredSecretPayload);
  if (!payload) throw new Error(`Stored secret is not migrated to ${SECRET_KEY_VERSION}.`);
  const keyBytes = Buffer.from(decryptionKey, 'base64url');
  const key = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export async function decryptStoredSecretPayloadFromEnv(payloadJson: string): Promise<string> {
  const decryptionKey = process.env.PRIMORDIA_DECRYPTION_KEY;
  if (!decryptionKey) throw new Error('PRIMORDIA_DECRYPTION_KEY is not set.');
  return decryptStoredSecretPayload(payloadJson, decryptionKey);
}

export async function encryptStoredSecretPayloadForTests(plaintext: string, decryptionKey: string): Promise<string> {
  const key = await subtle.importKey('raw', Buffer.from(decryptionKey, 'base64url'), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return JSON.stringify({ iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)), keyVersion: SECRET_KEY_VERSION });
}
