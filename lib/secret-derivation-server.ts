// Server-side half of Primordia secret key derivation.
//
// The browser deterministically derives one X25519 keypair per auth source from
// its local user secret. Each stored credential row keeps its own server X25519
// keypair in SQLite. The server derives PRIMORDIA_DECRYPTION_KEY for that row
// from the row private key and the browser/CLI public key, after verifying a
// one-time Ed25519 nonce signature.

import { createHash, randomBytes, webcrypto } from 'crypto';
import { getDb } from '@/lib/db';
import { base64ToBytes, bytesToBase64, bytesToBase64Url, SECRET_KEY_VERSION, selectCurrentSecretPayload, type CredentialProof, type StoredSecretPayload } from '@/lib/secret-derivation-shared';

const subtle = webcrypto.subtle;
const nonceTtlMs = 5 * 60 * 1000;
const issuedNonces = new Map<string, number>();

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function issueCredentialNonce(userId: string, authSource: string): string {
  const nonce = bytesToBase64Url(randomBytes(32));
  issuedNonces.set(`${userId}:${authSource}:${nonce}`, Date.now() + nonceTtlMs);
  return nonce;
}

function consumeCredentialNonce(userId: string, authSource: string, nonce: string): boolean {
  const key = `${userId}:${authSource}:${nonce}`;
  const expires = issuedNonces.get(key);
  issuedNonces.delete(key);
  if (!expires || expires < Date.now()) return false;
  for (const [k, exp] of issuedNonces) if (exp < Date.now()) issuedNonces.delete(k);
  return true;
}

export async function generateServerKeyPair(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const pair = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair;
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
  await db.setEncryptedCredentialServerKey(userId, authSource, JSON.stringify(generated.publicJwk), JSON.stringify(generated.privateJwk));
  return generated.publicJwk;
}

export async function rotateCredentialServerKeyPair(userId: string, authSource: string): Promise<JsonWebKey> {
  const db = await getDb();
  const generated = await generateServerKeyPair();
  await db.setEncryptedCredentialServerKey(userId, authSource, JSON.stringify(generated.publicJwk), JSON.stringify(generated.privateJwk));
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
  const privateKey = await subtle.importKey('jwk', JSON.parse(serverKey.privateJwk) as JsonWebKey, { name: 'X25519' }, false, ['deriveBits']);
  const publicKey = await subtle.importKey('jwk', secretPublicKey, { name: 'X25519' }, false, []);
  const shared = await subtle.deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256);
  return createHash('sha256').update('primordia-secret-encryption-v1').update(Buffer.from(shared)).digest('base64url');
}

export async function verifyCredentialProofAndDeriveKey(
  userId: string,
  authSource: string,
  proof: CredentialProof,
): Promise<string | undefined> {
  if (!consumeCredentialNonce(userId, authSource, proof.nonce)) return undefined;
  const signingKey = await subtle.importKey('jwk', proof.signingPublicKey, { name: 'Ed25519' }, false, ['verify']);
  const signedText = `${authSource}:${proof.nonce}:${proof.secretPublicKey.x ?? ''}`;
  const ok = await subtle.verify(
    { name: 'Ed25519' },
    signingKey,
    asBufferSource(Buffer.from(proof.signature, 'base64url')),
    new TextEncoder().encode(signedText),
  );
  if (!ok) return undefined;
  return deriveDecryptionKeyForCredential(userId, authSource, proof.secretPublicKey);
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
