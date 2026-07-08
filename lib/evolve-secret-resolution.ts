import { getDb } from '@/lib/db';
import { decryptStoredSecretPayload, deriveDecryptionKey } from '@/lib/secret-derivation-server';
import { isSecretAuthSource, type PresetAuthSource, type SecretAuthSource } from '@/lib/presets';

export type ResolvedEvolveSecret = {
  decryptionKey?: string;
  encryptedSecretPayload?: string;
  plaintext?: string;
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

export async function resolveStoredSecretForWorker(
  userId: string,
  authSource: PresetAuthSource | null | undefined,
  secretPublicKeyInput: unknown,
): Promise<ResolvedEvolveSecret> {
  const source = secretSourceForAuthSource(authSource);
  if (!source) return {};
  const db = await getDb();
  const encryptedSecretPayload = await db.getEncryptedCredential(userId, source);
  if (!encryptedSecretPayload) return {};

  const envDecryptionKey = process.env.PRIMORDIA_DECRYPTION_KEY;
  if (envDecryptionKey) return { decryptionKey: envDecryptionKey, encryptedSecretPayload };

  const secretPublicKey = parseSecretPublicKey(secretPublicKeyInput);
  if (!secretPublicKey) return {};

  const decryptionKey = await deriveDecryptionKey(secretPublicKey);
  return { decryptionKey, encryptedSecretPayload };
}

export async function resolveStoredSecretPlaintext(
  userId: string,
  authSource: PresetAuthSource | null | undefined,
  secretPublicKeyInput: unknown,
): Promise<string | undefined> {
  const resolved = await resolveStoredSecretForWorker(userId, authSource, secretPublicKeyInput);
  if (!resolved.encryptedSecretPayload || !resolved.decryptionKey) return undefined;
  return decryptStoredSecretPayload(resolved.encryptedSecretPayload, resolved.decryptionKey);
}
