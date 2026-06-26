import 'server-only';

import { getDb } from '@/lib/db';
import { MODEL_OPTIONS, type ModelOption } from '@/lib/agent-config';
import { withPresetAvailability, type EvolvePresetWithAvailability } from '@/lib/preset-availability';
import {
  BUILT_IN_PRESETS,
  PREF_CUSTOM_PRESETS,
  PREF_DISABLED_BUILT_IN_PRESETS,
  parseCustomPresets,
  parseDisabledBuiltInPresetIds,
  type SecretAuthSource,
} from '@/lib/presets';
import { listUserSecretSources } from '@/app/settings/data';

export interface PresetsSettingsPageData {
  secretSources: SecretAuthSource[];
  builtInPresets: EvolvePresetWithAvailability[];
  customPresets: EvolvePresetWithAvailability[];
  disabledBuiltInPresetIds: string[];
  modelOptionsByHarness: Record<string, ModelOption[]>;
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
