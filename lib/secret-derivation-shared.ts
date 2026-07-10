// Shared helpers for deriving per-source secret decryption keys.

export const USER_SECRET_STORAGE = 'primordia_aes_key';
export const SECRET_KEY_VERSION = 'x25519-source-v1';
export const SECRET_DERIVATION_PBKDF_ITERATIONS = 210_000;

export type UserSecretMaterial = {
  version: typeof SECRET_KEY_VERSION;
  seed: string;
};

export type StoredSecretPayload = {
  iv: string;
  ciphertext: string;
  keyVersion?: string;
  authSource?: import('./presets').SecretAuthSource;
  serverPublicKey?: JsonWebKey;
  versions?: Partial<Record<typeof SECRET_KEY_VERSION, {
    iv: string;
    ciphertext: string;
    keyVersion: typeof SECRET_KEY_VERSION;
    authSource?: import('./presets').SecretAuthSource;
    serverPublicKey?: JsonWebKey;
  }>>;
};

export type CredentialProof = {
  secretPublicKey: JsonWebKey;
  signingPublicKey: JsonWebKey;
  nonce: string;
  signature: string;
};

export function selectCurrentSecretPayload(payload: StoredSecretPayload): { iv: string; ciphertext: string; serverPublicKey?: JsonWebKey } | null {
  const current = payload.versions?.[SECRET_KEY_VERSION];
  if (current?.iv && current.ciphertext) return current;
  if (payload.keyVersion === SECRET_KEY_VERSION && payload.iv && payload.ciphertext) return payload;
  return null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return (bytes as Uint8Array & { toBase64(options?: { alphabet?: 'base64url'; omitPadding?: boolean }): string })
    .toBase64({ alphabet: 'base64url', omitPadding: true });
}

export function base64UrlToBytes(value: string): Uint8Array {
  return (Uint8Array as typeof Uint8Array & { fromBase64(encoded: string, options?: { alphabet?: 'base64url' }): Uint8Array })
    .fromBase64(value, { alphabet: 'base64url' });
}

export function isUserSecretMaterial(value: unknown): value is UserSecretMaterial {
  return !!value && typeof value === 'object' &&
    (value as { version?: unknown }).version === SECRET_KEY_VERSION &&
    typeof (value as { seed?: unknown }).seed === 'string';
}
