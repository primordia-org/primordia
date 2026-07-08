// Shared helpers for deriving the per-user secret decryption key.

export const USER_SECRET_STORAGE = 'primordia_aes_key';
export const SECRET_KEY_VERSION = 'ecdh-p256-v1';

export type UserSecretMaterial = {
  version: typeof SECRET_KEY_VERSION;
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
};

export type StoredSecretPayload = {
  iv: string;
  ciphertext: string;
  keyVersion?: string;
};

export type DecryptionKeyPayload = {
  secretPublicKey: JsonWebKey;
};

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export function isUserSecretMaterial(value: unknown): value is UserSecretMaterial {
  return !!value && typeof value === 'object' &&
    (value as { version?: unknown }).version === SECRET_KEY_VERSION &&
    typeof (value as { privateKey?: unknown }).privateKey === 'object' &&
    typeof (value as { publicKey?: unknown }).publicKey === 'object';
}
