// lib/preset-credentials-client.ts
// Client-side helpers for attaching exactly the credential selected by an evolve preset.

import { getCredentialProofForServer } from './secrets-client';
import type { PresetAuthSource } from './presets';

export type PresetCredentialFields = Partial<{
  credentialProof: string;
}>;

export async function getCredentialFieldsForAuthSource(authSource: PresetAuthSource | null | undefined): Promise<PresetCredentialFields> {
  if (!authSource || authSource === 'exe-dev-gateway') return {};
  const credentialProof = await getCredentialProofForServer(authSource);
  return credentialProof ? { credentialProof: JSON.stringify(credentialProof) } : {};
}

export async function appendCredentialFieldsForAuthSource(formData: FormData, authSource: PresetAuthSource | null | undefined): Promise<void> {
  const fields = await getCredentialFieldsForAuthSource(authSource);
  for (const [key, value] of Object.entries(fields)) {
    if (value) formData.append(key, value);
  }
}
