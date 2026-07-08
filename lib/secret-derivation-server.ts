// Server-side half of Primordia secret key derivation.
//
// The browser keeps a per-user ECDH private key in localStorage. Each stored
// credential row keeps its own server ECDH keypair in SQLite. The server derives
// PRIMORDIA_DECRYPTION_KEY for that single row from the row's private key and
// the browser/CLI public key.

import { createHash, createPrivateKey, createPublicKey, diffieHellman, webcrypto, type JsonWebKey as NodeJsonWebKey } from 'crypto';
import { getDb } from '@/lib/db';
import { base64ToBytes, bytesToBase64, SECRET_KEY_VERSION, selectCurrentSecretPayload, type StoredSecretPayload } from '@/lib/secret-derivation-shared';

const subtle = webcrypto.subtle;

export async function generateServerKeyPair(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    publicJwk: await subtle.exportKey('jwk', pair.publicKey),
    privateJwk: await subtle.exportKey('jwk', pair.privateKey),
  };
}

export async function getOrCreateCredentialServerPublicJwk(userId: string, authSource: string): Promise<JsonWebKey> {
  const db = await getDb();
  const existing = await db.getEncryptedCredentialServerKey(userId, authSource);
  if (existing) return JSON.parse(existing.publicJwk) as JsonWebKey;

  const generated = await generateServerKeyPair();
  await db.setEncryptedCredentialServerKey(
    userId,
    authSource,
    JSON.stringify(generated.publicJwk),
    JSON.stringify(generated.privateJwk),
  );
  return generated.publicJwk;
}

export async function rotateCredentialServerKeyPair(userId: string, authSource: string): Promise<JsonWebKey> {
  const db = await getDb();
  const generated = await generateServerKeyPair();
  await db.setEncryptedCredentialServerKey(
    userId,
    authSource,
    JSON.stringify(generated.publicJwk),
    JSON.stringify(generated.privateJwk),
  );
  return generated.publicJwk;
}

export async function deriveDecryptionKeyForCredential(
  userId: string,
  authSource: string,
  secretPublicKey: JsonWebKey,
): Promise<string | undefined> {
  const db = await getDb();
  const serverKey = await db.getEncryptedCredentialServerKey(userId, authSource);
  if (!serverKey) return undefined;
  const privateKey = createPrivateKey({ key: JSON.parse(serverKey.privateJwk) as NodeJsonWebKey, format: 'jwk' });
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
