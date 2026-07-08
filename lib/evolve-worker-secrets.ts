import { decryptStoredSecretPayloadFromEnv } from '@/lib/secret-derivation-server';
import { type PresetAuthSource } from '@/lib/presets';

export type WorkerSecretConfig = {
  authSource?: string | null;
  encryptedSecretPayload?: string;
};

export type WorkerSecretValues = {
  apiKey?: string;
  credentials?: string;
  chatGptOAuth?: string;
};

export async function resolveWorkerSecrets(config: WorkerSecretConfig): Promise<WorkerSecretValues> {
  if (!config.authSource || config.authSource === 'exe-dev-gateway' || !config.encryptedSecretPayload) return {};
  const plaintext = await decryptStoredSecretPayloadFromEnv(config.encryptedSecretPayload);
  const authSource = config.authSource as PresetAuthSource;
  if (authSource === 'claude-subscription') return { credentials: plaintext };
  if (authSource === 'chatgpt-subscription') return { chatGptOAuth: plaintext };
  return { apiKey: plaintext };
}
