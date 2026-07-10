// lib/worker-secret-env.ts
// Worker-side lookup/decryption for user secrets stored by lib/secrets-client.

import { decryptStoredSecretForUser } from '@/lib/server-secrets';
import { isSecretAuthSource, type SecretAuthSource } from '@/lib/presets';

interface DecryptedWorkerSecret {
  apiKey?: string;
  credentials?: string;
  chatGptOAuth?: string;
}

export async function decryptWorkerSecretForUser(userId: string | undefined, aesKeyJwkJson: string | undefined, authSource: string | null | undefined): Promise<DecryptedWorkerSecret> {
  if (!userId || !aesKeyJwkJson || !authSource || authSource === 'exe-dev-gateway') return {};
  if (!isSecretAuthSource(authSource)) return {};

  const plaintext = await decryptStoredSecretForUser(userId, authSource as SecretAuthSource, aesKeyJwkJson);
  if (!plaintext) return {};

  if (authSource === 'claude-subscription') return { credentials: plaintext };
  if (authSource === 'chatgpt-subscription') return { chatGptOAuth: plaintext };
  return { apiKey: plaintext };
}
