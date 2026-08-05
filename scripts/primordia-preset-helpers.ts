import { getDb } from '@/lib/db';
import { resolvePrimordiaApiKey } from '@/lib/api-keys';
import {
  BUILT_IN_PRESETS,
  PREF_CUSTOM_PRESETS,
  parseCustomPresets,
  type ThreadPreset,
} from '@/lib/presets';
import type { CliCompletionContext } from '@/lib/tiny-command/common';

export function shortBuiltInPresetId(presetId: string): string {
  return presetId.startsWith('builtin:') ? presetId.slice('builtin:'.length) : presetId;
}

export function builtInCliPresetIds(): string[] {
  return BUILT_IN_PRESETS.map((preset) => shortBuiltInPresetId(preset.id));
}

function slugifyPresetName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'preset';
}

function customPresetCliEntries(customPresets: ThreadPreset[]): Array<{ cliId: string; presetId: string }> {
  const used = new Set(builtInCliPresetIds());
  return customPresets.map((preset) => {
    const base = slugifyPresetName(preset.name);
    let cliId = base;
    for (let suffix = 2; used.has(cliId); suffix += 1) {
      cliId = `${base}-${suffix}`;
    }
    used.add(cliId);
    return { cliId, presetId: preset.id };
  });
}

async function resolveCompletionUserId(): Promise<string | null> {
  if (!process.env.PRIMORDIA_API_KEY) return null;
  const resolved = await resolvePrimordiaApiKey(process.env.PRIMORDIA_API_KEY);
  return resolved.userId;
}

async function customPresetsForUser(userId: string): Promise<ThreadPreset[]> {
  const db = await getDb();
  const prefs = await db.getUserPreferences(userId, [PREF_CUSTOM_PRESETS]);
  return parseCustomPresets(prefs[PREF_CUSTOM_PRESETS]);
}

export async function completeCliPresetIds(_context: CliCompletionContext): Promise<string[]> {
  const builtIns = builtInCliPresetIds();
  const userId = await resolveCompletionUserId();
  if (!userId) return builtIns;

  const customPresets = await customPresetsForUser(userId);
  return [...builtIns, ...customPresetCliEntries(customPresets).map((entry) => entry.cliId)];
}

export async function resolveCliPresetIdForUser(userId: string, cliPresetId: string | undefined): Promise<string | undefined> {
  if (!cliPresetId || cliPresetId.includes(':')) return cliPresetId;

  const builtInPresetId = `builtin:${cliPresetId}`;
  if (BUILT_IN_PRESETS.some((preset) => preset.id === builtInPresetId)) return builtInPresetId;

  const customPresets = await customPresetsForUser(userId);
  const match = customPresetCliEntries(customPresets).find((entry) => entry.cliId === cliPresetId);
  return match?.presetId ?? cliPresetId;
}
