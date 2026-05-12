import 'server-only';

import { getDb } from '@/lib/db';
import {
  BUILT_IN_PRESETS,
  PREF_CUSTOM_PRESETS,
  PREF_DISABLED_BUILT_IN_PRESETS,
  SECRET_AUTH_SOURCES,
  isSecretAuthSource,
  parseCustomPresets,
  parseDisabledBuiltInPresetIds,
  type SecretCiphertexts,
  type SecretAuthSource,
} from '@/lib/presets';
import { MODEL_OPTIONS, type ModelOption } from '@/lib/agent-config';
import { withPresetAvailability, type EvolvePresetWithAvailability } from '@/lib/preset-availability';

export interface SettingsPageData {
  secretSources: SecretAuthSource[];
  secretCiphertexts: SecretCiphertexts;
}

export interface PresetsSettingsPageData {
  secretSources: SecretAuthSource[];
  builtInPresets: EvolvePresetWithAvailability[];
  customPresets: EvolvePresetWithAvailability[];
  disabledBuiltInPresetIds: string[];
  modelOptionsByHarness: Record<string, ModelOption[]>;
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

export async function getPresetsSettingsPageData(userId: string): Promise<PresetsSettingsPageData> {
  const db = await getDb();
  const [prefs, secretSources] = await Promise.all([
    db.getUserPreferences(userId, [PREF_CUSTOM_PRESETS, PREF_DISABLED_BUILT_IN_PRESETS]),
    listUserSecretSources(userId),
  ]);
  const storedAuthSources = new Set<string>(secretSources);

  return {
    secretSources,
    builtInPresets: BUILT_IN_PRESETS.map((preset) => withPresetAvailability(preset, storedAuthSources)),
    customPresets: parseCustomPresets(prefs[PREF_CUSTOM_PRESETS]).map((preset) => withPresetAvailability(preset, storedAuthSources)),
    disabledBuiltInPresetIds: parseDisabledBuiltInPresetIds(prefs[PREF_DISABLED_BUILT_IN_PRESETS]),
    modelOptionsByHarness: MODEL_OPTIONS,
  };
}
