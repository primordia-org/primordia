// lib/llm-encryption.ts
// Server-side RSA-OAEP keypair for hybrid-encrypted secrets in transit.
//
// An ephemeral 2048-bit RSA-OAEP keypair is generated once per server process
// lifetime (lazy, on first call). The private key never leaves the server
// process — clients encrypt with the public key (JWK) and the server decrypts.
//
// Because the keypair is ephemeral, clients must re-encrypt on each page
// session. The public key is fetched fresh via /api/llm-key/public-key on
// every evolve/chat submission so that a server restart is handled gracefully.

import { webcrypto } from 'crypto';

const subtle = webcrypto.subtle as SubtleCrypto;

// Lazily-initialised promise — resolves to the generated keypair once and
// reuses that same keypair for the lifetime of the process.
let keyPairPromise: Promise<CryptoKeyPair> | null = null;

function getKeyPair(): Promise<CryptoKeyPair> {
  if (!keyPairPromise) {
    keyPairPromise = subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,   // extractable (public key must be exported as JWK)
      ['encrypt', 'decrypt'],
    ) as Promise<CryptoKeyPair>;
  }
  return keyPairPromise;
}

/** Returns the server's RSA public key as a JSON Web Key (JWK) for the client. */
export async function getPublicKeyJwk(): Promise<JsonWebKey> {
  const { publicKey } = await getKeyPair();
  return subtle.exportKey('jwk', publicKey);
}

export type HybridEncryptedPayload = { wrappedKey: string; iv: string; ciphertext: string };

function isHybridEncryptedPayload(value: unknown): value is HybridEncryptedPayload {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as Partial<HybridEncryptedPayload>).wrappedKey === 'string' &&
      typeof (value as Partial<HybridEncryptedPayload>).iv === 'string' &&
      typeof (value as Partial<HybridEncryptedPayload>).ciphertext === 'string'
  );
}

/**
 * Decrypts an encrypted API key. New clients send the same hybrid envelope used
 * for all secrets. Legacy direct RSA-OAEP base64 payloads are still accepted so
 * older open tabs do not fail during deploy.
 */
export async function decryptApiKey(payloadOrCiphertext: string | HybridEncryptedPayload): Promise<string> {
  if (isHybridEncryptedPayload(payloadOrCiphertext)) {
    return decryptHybridCredentials(payloadOrCiphertext);
  }

  try {
    const parsed = JSON.parse(payloadOrCiphertext) as unknown;
    if (isHybridEncryptedPayload(parsed)) return decryptHybridCredentials(parsed);
  } catch {
    // Legacy plain base64 RSA-OAEP ciphertext.
  }

  const { privateKey } = await getKeyPair();
  const ciphertext = Buffer.from(payloadOrCiphertext, 'base64');
  const plaintext = await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, ciphertext);
  return new TextDecoder().decode(plaintext);
}

/**
 * Decrypts a hybrid-encrypted secret payload produced by the client's
 * `encryptSecretForTransmission()`. The payload format:
 *   { wrappedKey: string, iv: string, ciphertext: string } (all base64)
 *
 * The client uses a hybrid scheme: an ephemeral AES-256-GCM key encrypts the
 * payload, and RSA-OAEP encrypts only the 32-byte AES key.
 *
 * Throws if the wrapped key was encrypted with a different keypair or if the
 * ciphertext is corrupt.
 */
export async function decryptHybridCredentials(payload: HybridEncryptedPayload): Promise<string> {
  const { privateKey } = await getKeyPair();

  // 1. Unwrap the ephemeral AES key using RSA-OAEP
  const wrappedKeyBytes = Buffer.from(payload.wrappedKey, 'base64');
  const aesKeyRaw = await subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    wrappedKeyBytes,
  );

  // 2. Import the raw AES key
  const aesKey = await subtle.importKey(
    'raw',
    aesKeyRaw,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  // 3. Decrypt the payload with AES-GCM
  const iv = Buffer.from(payload.iv, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}
