import { getDb } from '@/lib/db';
import {
  BUILT_IN_PRESETS,
  PREF_CUSTOM_PRESETS,
  parseCustomPresets,
  type ThreadPreset,
} from '@/lib/presets';
import type { CliCompletionContext } from '@/lib/tiny-cli';

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

function optionValue(words: string[], optionName: string): string | undefined {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === `--${optionName}`) {
      const value = words[index + 1];
      if (value && !value.startsWith('-')) return value;
    } else if (word.startsWith(`--${optionName}=`)) {
      const value = word.slice(optionName.length + 3);
      if (value) return value;
    }
  }
  return undefined;
}

async function resolveCompletionUserId(selector: string | undefined): Promise<string | null> {
  const db = await getDb();
  if (selector) {
    const selected = (await db.getUserById(selector)) ?? (await db.getUserByUsername(selector));
    return selected?.id ?? null;
  }

  const users = await db.getAllUsers();
  return users.length === 1 ? users[0].id : null;
}

async function customPresetsForUser(userId: string): Promise<ThreadPreset[]> {
  const db = await getDb();
  const prefs = await db.getUserPreferences(userId, [PREF_CUSTOM_PRESETS]);
  return parseCustomPresets(prefs[PREF_CUSTOM_PRESETS]);
}

export async function completeCliPresetIds(context: CliCompletionContext): Promise<string[]> {
  const builtIns = builtInCliPresetIds();
  const selector = optionValue(context.words, 'user');
  const userId = await resolveCompletionUserId(selector);
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
