import { getDb } from '@/lib/db';
import { decryptStoredSecretPayload, deriveDecryptionKey } from '@/lib/secret-derivation-server';
import { isSecretAuthSource, type PresetAuthSource, type SecretAuthSource } from '@/lib/presets';

export type ResolvedEvolveSecret = {
  decryptionKey?: string;
  hasStoredSecret: boolean;
};

export function parseSecretPublicKey(value: unknown): JsonWebKey | null {
  const candidate = value ?? process.env.PRIMORDIA_USER_SECRET;
  if (!candidate) return null;
  if (typeof candidate === 'object') return candidate as JsonWebKey;
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const variants = [candidate, Buffer.from(candidate, 'base64url').toString('utf8')];
  for (const variant of variants) {
    try {
      const parsed = JSON.parse(variant) as JsonWebKey | { publicKey?: JsonWebKey };
      return 'publicKey' in parsed && parsed.publicKey ? parsed.publicKey : parsed as JsonWebKey;
    } catch {}
  }
  return null;
}

export function secretSourceForAuthSource(authSource: PresetAuthSource | null | undefined): SecretAuthSource | null {
  return authSource && isSecretAuthSource(authSource) ? authSource : null;
}

export async function deriveEvolveDecryptionKey(secretPublicKeyInput: unknown): Promise<string | undefined> {
  const envDecryptionKey = process.env.PRIMORDIA_DECRYPTION_KEY;
  if (envDecryptionKey) return envDecryptionKey;
  const secretPublicKey = parseSecretPublicKey(secretPublicKeyInput);
  return secretPublicKey ? deriveDecryptionKey(secretPublicKey) : undefined;
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

  const decryptionKey = await deriveEvolveDecryptionKey(secretPublicKeyInput);
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
  publicKey: unknown,
  authSource: PresetAuthSource | null | undefined,
): Promise<string | undefined> {
  const source = secretSourceForAuthSource(authSource);
  if (!source) return undefined;
  const decryptionKey = await deriveEvolveDecryptionKey(publicKey);
  if (!decryptionKey) return undefined;
  const db = await getDb();
  const encryptedSecretPayload = await db.getEncryptedCredential(userId, source);
  if (!encryptedSecretPayload) return undefined;
  return decryptStoredSecretPayload(encryptedSecretPayload, decryptionKey);
}

export const resolveStoredSecretPlaintext = getPlaintextCredentialsForUser;
