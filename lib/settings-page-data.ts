import 'server-only';

import { getDb } from './db';
import {
  AUTH_SOURCE_BY_TYPE,
  TYPE_BY_AUTH_SOURCE,
  isSecretAuthSource,
  type SecretCiphertexts,
  type SecretType,
} from './secret-types';

export interface SettingsPageData {
  secretTypes: SecretType[];
  secretCiphertexts: SecretCiphertexts;
}

const SETTINGS_SECRET_TYPES: SecretType[] = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'CLAUDE_CODE_CREDENTIALS_JSON',
  'CHATGPT_SUBSCRIPTION_OAUTH',
];

export async function listUserSecretTypes(userId: string): Promise<SecretType[]> {
  const db = await getDb();
  const authSources = await db.listEncryptedCredentialSources(userId);
  return authSources.filter(isSecretAuthSource).map((source) => TYPE_BY_AUTH_SOURCE[source]);
}

export async function getSettingsPageData(userId: string): Promise<SettingsPageData> {
  const db = await getDb();
  const [secretTypes, ciphertextEntries] = await Promise.all([
    listUserSecretTypes(userId),
    Promise.all(
      SETTINGS_SECRET_TYPES.map(async (type) => {
        const value = await db.getEncryptedCredential(userId, AUTH_SOURCE_BY_TYPE[type]);
        return [type, value && value.length > 0 ? value : null] as const;
      }),
    ),
  ]);

  return {
    secretTypes,
    secretCiphertexts: Object.fromEntries(ciphertextEntries) as SecretCiphertexts,
  };
}
