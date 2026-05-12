// lib/llm-encryption.ts
// Server-side RSA-OAEP keypair for hybrid-encrypted secrets in transit.
//
// The keypair is persisted outside production worktrees so zero-downtime
// blue/green deploys keep accepting envelopes encrypted by already-open tabs.
// The browser still owns the long-lived AES key for stored credentials; this
// RSA key is only a short-hop transport key for submitting a request.

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { webcrypto } from 'crypto';

const subtle = webcrypto.subtle as SubtleCrypto;
const KEYPAIR_FILE = '.primordia-credential-transport-keypair.json';

type PersistedKeyPair = {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
};

function keyPairPath(): string {
  return path.join(process.env.PRIMORDIA_DIR || process.cwd(), KEYPAIR_FILE);
}

async function importPersistedKeyPair(persisted: PersistedKeyPair): Promise<CryptoKeyPair> {
  const [publicKey, privateKey] = await Promise.all([
    subtle.importKey(
      'jwk',
      persisted.publicKey,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt'],
    ),
    subtle.importKey(
      'jwk',
      persisted.privateKey,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    ),
  ]);
  return { publicKey, privateKey };
}

async function generatePersistedKeyPair(): Promise<PersistedKeyPair> {
  const generated = (await subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )) as CryptoKeyPair;

  const [publicKey, privateKey] = await Promise.all([
    subtle.exportKey('jwk', generated.publicKey),
    subtle.exportKey('jwk', generated.privateKey),
  ]);
  return { publicKey, privateKey };
}

async function loadOrCreatePersistedKeyPair(): Promise<CryptoKeyPair> {
  const file = keyPairPath();
  try {
    const existing = JSON.parse(await readFile(file, 'utf8')) as PersistedKeyPair;
    return importPersistedKeyPair(existing);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  const persisted = await generatePersistedKeyPair();
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(file, JSON.stringify(persisted), { mode: 0o600, flag: 'wx' });
  } catch (err) {
    // Another prod slot may have created the key at the same time. Use the
    // winner's key so old and new servers converge on one transport key.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      const existing = JSON.parse(await readFile(file, 'utf8')) as PersistedKeyPair;
      return importPersistedKeyPair(existing);
    }
    throw err;
  }

  return importPersistedKeyPair(persisted);
}

// Lazily-initialised promise — resolves to the persisted keypair once and
// reuses that same keypair for the lifetime of the process.
let keyPairPromise: Promise<CryptoKeyPair> | null = null;

function getKeyPair(): Promise<CryptoKeyPair> {
  if (!keyPairPromise) keyPairPromise = loadOrCreatePersistedKeyPair();
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

/** Decrypts an API key from the same hybrid envelope used for all secrets. */
export async function decryptApiKey(payload: string | HybridEncryptedPayload): Promise<string> {
  if (isHybridEncryptedPayload(payload)) return decryptHybridCredentials(payload);

  const parsed = JSON.parse(payload) as unknown;
  if (!isHybridEncryptedPayload(parsed)) {
    throw new Error('Invalid hybrid encrypted API key payload');
  }
  return decryptHybridCredentials(parsed);
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
