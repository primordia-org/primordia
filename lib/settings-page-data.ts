import 'server-only';

import { getDb } from './db';
import {
  SECRET_AUTH_SOURCES,
  isSecretAuthSource,
  type SecretCiphertexts,
  type SecretAuthSource,
} from './presets';

export interface SettingsPageData {
  secretSources: SecretAuthSource[];
  secretCiphertexts: SecretCiphertexts;
}

export async function listUserSecretSources(userId: string): Promise<SecretAuthSource[]> {
  const db = await getDb();
  const authSources = await db.listEncryptedCredentialSources(userId);
  return authSources.filter(isSecretAuthSource);
}

export async function getSettingsPageData(userId: string): Promise<SettingsPageData> {
  const db = await getDb();
  const [secretSources, ciphertextEntries] = await Promise.all([
    listUserSecretSources(userId),
    Promise.all(
      SECRET_AUTH_SOURCES.map(async (authSource) => {
        const value = await db.getEncryptedCredential(userId, authSource);
        return [authSource, value && value.length > 0 ? value : null] as const;
      }),
    ),
  ]);

  return {
    secretSources,
    secretCiphertexts: Object.fromEntries(ciphertextEntries) as SecretCiphertexts,
  };
}
