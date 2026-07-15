// lib/preset-credentials-client.ts
// Client-side helpers for attaching the user's Primordia AES key to thread requests.
// The server uses this key to decrypt the already-stored selected secret and
// passes the same key to the detached worker via PRIMORDIA_AES_KEY.

import type { PresetAuthSource } from './presets';

const AES_KEY_STORAGE = 'primordia_aes_key';

export type PresetCredentialFields = Partial<{
  primordiaAesKey: string;
}>;

function authSourceNeedsSecret(authSource: PresetAuthSource | null | undefined): boolean {
  return authSource !== null && authSource !== undefined && authSource !== 'exe-dev-gateway';
}

export async function getCredentialFieldsForAuthSource(authSource: PresetAuthSource | null | undefined): Promise<PresetCredentialFields> {
  if (!authSourceNeedsSecret(authSource)) return {};

  const primordiaAesKey = localStorage.getItem(AES_KEY_STORAGE);
  return primordiaAesKey ? { primordiaAesKey } : {};
}

export async function appendCredentialFieldsForAuthSource(formData: FormData, authSource: PresetAuthSource | null | undefined): Promise<void> {
  const fields = await getCredentialFieldsForAuthSource(authSource);
  for (const [key, value] of Object.entries(fields)) {
    if (value) formData.append(key, value);
  }
}
