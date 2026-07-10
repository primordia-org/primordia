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

export function isUserSecretMaterial(value: unknown): value is UserSecretMaterial {
  return !!value && typeof value === 'object' &&
    (value as { version?: unknown }).version === SECRET_KEY_VERSION &&
    typeof (value as { seed?: unknown }).seed === 'string';
}
