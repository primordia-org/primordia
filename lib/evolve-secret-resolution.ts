import { getDb } from '@/lib/db';
import { decryptStoredSecretPayload, deriveDecryptionKeyForCredential, verifyCredentialProofAndDeriveKey } from '@/lib/secret-derivation-server';
import type { CredentialProof } from '@/lib/secret-derivation-shared';
import { isSecretAuthSource, type PresetAuthSource, type SecretAuthSource } from '@/lib/presets';

export type ResolvedEvolveSecret = {
  decryptionKey?: string;
  hasStoredSecret: boolean;
};

export function parseCredentialProof(value: unknown): CredentialProof | null {
  const candidate = value ?? process.env.PRIMORDIA_USER_SECRET;
  if (!candidate) return null;
  if (typeof candidate === 'object') return candidate as CredentialProof;
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const variants = [candidate, Buffer.from(candidate, 'base64url').toString('utf8')];
  for (const variant of variants) {
    try { return JSON.parse(variant) as CredentialProof; } catch {}
  }
  return null;
}

export function secretSourceForAuthSource(authSource: PresetAuthSource | null | undefined): SecretAuthSource | null {
  return authSource && isSecretAuthSource(authSource) ? authSource : null;
}

export async function deriveEvolveDecryptionKey(userId: string, authSource: SecretAuthSource, proofInput: unknown): Promise<string | undefined> {
  const envDecryptionKey = process.env.PRIMORDIA_DECRYPTION_KEY;
  if (envDecryptionKey) return envDecryptionKey;
  const proof = parseCredentialProof(proofInput);
  return proof ? verifyCredentialProofAndDeriveKey(userId, authSource, proof) : undefined;
}

export async function resolveStoredSecretForWorker(
  userId: string,
  authSource: PresetAuthSource | null | undefined,
  secretPublicKeyInput: unknown,
): Promise<ResolvedEvolveSecret> {
  const source = secretSourceForAuthSource(authSource);
  if (!source) return { hasStoredSecret: false };
  const db = await getDb();
  const encryptedSecretPayload = await db.getEncryptedCredential(userId, source);
  if (!encryptedSecretPayload) return { hasStoredSecret: false };

  const decryptionKey = await deriveEvolveDecryptionKey(userId, source, secretPublicKeyInput);
  return { decryptionKey, hasStoredSecret: true };
}

/**
 * Resolve a user's selected stored credential to plaintext.
 *
 * This is intentionally small and CLI-friendly: provide the Primordia user ID,
 * the browser/CLI ECDH public key (or set PRIMORDIA_DECRYPTION_KEY), and the
 * preset auth source. The encrypted payload is read from SQLite and decrypted
 * server-side with the derived key.
 */
export async function getPlaintextCredentialsForUser(
  userId: string,
  publicKeyOrProof: unknown,
  authSource: PresetAuthSource | null | undefined,
): Promise<string | undefined> {
  const source = secretSourceForAuthSource(authSource);
  if (!source) return undefined;
  const proof = parseCredentialProof(publicKeyOrProof);
  const decryptionKey = proof
    ? await verifyCredentialProofAndDeriveKey(userId, source, proof)
    : await deriveDecryptionKeyForCredential(userId, source, publicKeyOrProof as JsonWebKey);
  if (!decryptionKey) return undefined;
  const db = await getDb();
  const encryptedSecretPayload = await db.getEncryptedCredential(userId, source);
  if (!encryptedSecretPayload) return undefined;
  return decryptStoredSecretPayload(encryptedSecretPayload, decryptionKey);
}

export const resolveStoredSecretPlaintext = getPlaintextCredentialsForUser;
