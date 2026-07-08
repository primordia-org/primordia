// lib/preset-credentials-client.ts
// Client-side helpers for attaching exactly the credential selected by an evolve preset.

import { getSecretPublicKeyForServer } from './secrets-client';
import type { PresetAuthSource } from './presets';

export type PresetCredentialFields = Partial<{
  secretPublicKey: string;
}>;

export async function getCredentialFieldsForAuthSource(authSource: PresetAuthSource | null | undefined): Promise<PresetCredentialFields> {
  if (!authSource || authSource === 'exe-dev-gateway') return {};
  const secretPublicKey = await getSecretPublicKeyForServer();
  return secretPublicKey ? { secretPublicKey: JSON.stringify(secretPublicKey) } : {};
}

export async function appendCredentialFieldsForAuthSource(formData: FormData, authSource: PresetAuthSource | null | undefined): Promise<void> {
  const fields = await getCredentialFieldsForAuthSource(authSource);
  for (const [key, value] of Object.entries(fields)) {
    if (value) formData.append(key, value);
  }
}
