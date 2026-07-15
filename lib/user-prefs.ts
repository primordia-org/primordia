// lib/user-prefs.ts
// Server-side helpers for reading per-user preferences from the database.
// Intended to be called inside server components and API route handlers.

import { getDb } from "./db";
import {
  DEFAULT_HARNESS,
  DEFAULT_MODEL,
  HARNESS_OPTIONS,
  CAVEMAN_INTENSITIES,
  DEFAULT_CAVEMAN_INTENSITY,
  type CavemanIntensity,
} from "./agent-config";
import { MODEL_OPTIONS } from "./agent-config";
import { BRANCH_PARENT_SOURCES, DEFAULT_BRANCH_PARENT_SOURCE, type BranchParentSource } from "./branch-parent";

export const PREF_HARNESS = "evolve:preferred-harness";
export const PREF_MODEL = "evolve:preferred-model";
export const PREF_CAVEMAN = "evolve:caveman-mode";
export const PREF_CAVEMAN_INTENSITY = "evolve:caveman-intensity";
export const PREF_BRANCH_PARENT_SOURCE = "branches:parent-source";

// Re-export for callers that import caveman constants from this module.
export { CAVEMAN_INTENSITIES, DEFAULT_CAVEMAN_INTENSITY, type CavemanIntensity } from "./agent-config";
export { BRANCH_PARENT_SOURCES, DEFAULT_BRANCH_PARENT_SOURCE, type BranchParentSource } from "./branch-parent";

export interface ThreadPrefs {
  initialHarness: string;
  initialModel: string;
  initialCavemanMode: boolean;
  initialCavemanIntensity: CavemanIntensity;
}

/**
 * Read the user's preferred thread harness, model, and caveman settings from the database.
 * Preference keys keep their original `evolve:*` names for compatibility.
 * Falls back to compile-time defaults if the preference is missing or
 * references an option that no longer exists.
 *
 * Safe to call in server components and route handlers — never throws.
 */
export async function getBranchParentSource(userId: string | null | undefined): Promise<BranchParentSource> {
  if (!userId) return DEFAULT_BRANCH_PARENT_SOURCE;
  try {
    const db = await getDb();
    const prefs = await db.getUserPreferences(userId, [PREF_BRANCH_PARENT_SOURCE]);
    return (BRANCH_PARENT_SOURCES as readonly string[]).includes(prefs[PREF_BRANCH_PARENT_SOURCE])
      ? (prefs[PREF_BRANCH_PARENT_SOURCE] as BranchParentSource)
      : DEFAULT_BRANCH_PARENT_SOURCE;
  } catch {
    return DEFAULT_BRANCH_PARENT_SOURCE;
  }
}

export async function getThreadPrefs(userId: string): Promise<ThreadPrefs> {
  try {
    const db = await getDb();
    const prefs = await db.getUserPreferences(userId, [PREF_HARNESS, PREF_MODEL, PREF_CAVEMAN, PREF_CAVEMAN_INTENSITY]);

    const harness = prefs[PREF_HARNESS];
    const model = prefs[PREF_MODEL];

    const validHarness =
      harness && HARNESS_OPTIONS.find((h) => h.id === harness) ? harness : DEFAULT_HARNESS;
    const models = MODEL_OPTIONS[validHarness] ?? [];
    const validModel = (model && models.find((m) => m.id === model)) ? model : (models[0]?.id ?? DEFAULT_MODEL);

    const cavemanMode = prefs[PREF_CAVEMAN] === "true";
    const rawIntensity = prefs[PREF_CAVEMAN_INTENSITY];
    const validIntensity = (CAVEMAN_INTENSITIES as readonly string[]).includes(rawIntensity)
      ? (rawIntensity as CavemanIntensity)
      : DEFAULT_CAVEMAN_INTENSITY;

    return { initialHarness: validHarness, initialModel: validModel, initialCavemanMode: cavemanMode, initialCavemanIntensity: validIntensity };
  } catch {
    return { initialHarness: DEFAULT_HARNESS, initialModel: DEFAULT_MODEL, initialCavemanMode: false, initialCavemanIntensity: DEFAULT_CAVEMAN_INTENSITY };
  }
}
