import { getPlaintextCredentialsForUser } from '@/lib/evolve-secret-resolution';
import { type PresetAuthSource } from '@/lib/presets';

export type WorkerSecretConfig = {
  userId?: string;
  authSource?: string | null;
};

export type WorkerSecretValues = {
  apiKey?: string;
  credentials?: string;
  chatGptOAuth?: string;
};

export async function resolveWorkerSecrets(config: WorkerSecretConfig): Promise<WorkerSecretValues> {
  if (!config.userId || !config.authSource || config.authSource === 'exe-dev-gateway') return {};
  const plaintext = await getPlaintextCredentialsForUser(
    config.userId,
    null,
    config.authSource as PresetAuthSource,
  );
  if (!plaintext) return {};
  const authSource = config.authSource as PresetAuthSource;
  if (authSource === 'claude-subscription') return { credentials: plaintext };
  if (authSource === 'chatgpt-subscription') return { chatGptOAuth: plaintext };
  return { apiKey: plaintext };
}
