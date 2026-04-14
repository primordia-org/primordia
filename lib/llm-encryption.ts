// lib/llm-encryption.ts
// Server-side RSA-OAEP keypair for encrypting API keys in transit.
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

/**
 * Decrypts a base64-encoded RSA-OAEP ciphertext produced by the client.
 * Throws if the ciphertext was encrypted with a different (e.g. old) keypair.
 */
export async function decryptApiKey(ciphertextBase64: string): Promise<string> {
  const { privateKey } = await getKeyPair();
  const ciphertext = Buffer.from(ciphertextBase64, 'base64');
  const plaintext = await subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}
