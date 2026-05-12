// app/api/evolve/presets/route.ts
// Returns evolve presets for current user, including unavailable presets with reasons.

import { getSessionUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  BUILT_IN_PRESETS,
  PREF_CUSTOM_PRESETS,
  PREF_DISABLED_BUILT_IN_PRESETS,
  PREF_PRESET,
  parseCustomPresets,
  parseDisabledBuiltInPresetIds,
  SECRET_AUTH_SOURCES,
} from '@/lib/presets';
import { withPresetAvailability } from '@/lib/preset-availability';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const db = await getDb();
  const prefs = await db.getUserPreferences(user.id, [
    PREF_CUSTOM_PRESETS,
    PREF_DISABLED_BUILT_IN_PRESETS,
    PREF_PRESET,
  ]);
  const storedAuthSources = new Set<string>();
  for (const authSource of SECRET_AUTH_SOURCES) {
    const stored = await db.getEncryptedCredential(user.id, authSource);
    if (stored) storedAuthSources.add(authSource);
  }
  const disabledBuiltIns = new Set(parseDisabledBuiltInPresetIds(prefs[PREF_DISABLED_BUILT_IN_PRESETS]));
  const presets = [
    ...BUILT_IN_PRESETS.filter((preset) => !disabledBuiltIns.has(preset.id)),
    ...parseCustomPresets(prefs[PREF_CUSTOM_PRESETS]),
  ];
  const presetsWithAvailability = presets.map((preset) => withPresetAvailability(preset, storedAuthSources));
  const availablePresets = presetsWithAvailability.filter((preset) => preset.available);
  const preferredPresetId = prefs[PREF_PRESET] || null;
  const selected = availablePresets.find((p) => p.id === preferredPresetId) ?? availablePresets[0] ?? null;

  return Response.json({ presets: presetsWithAvailability, selectedPresetId: selected?.id ?? null });
}
