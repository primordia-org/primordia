// app/api/settings/presets/route.ts
// CRUD-ish storage for user-defined evolve presets.

import { getSessionUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  BUILT_IN_PRESETS,
  PREF_CUSTOM_PRESETS,
  PREF_DISABLED_BUILT_IN_PRESETS,
  parseCustomPresets,
  serializeCustomPresets,
  parseDisabledBuiltInPresetIds,
  serializeDisabledBuiltInPresetIds,
  normalizeAuthSource,
  SECRET_AUTH_SOURCES,
  type EvolvePreset,
} from '@/lib/presets';
import { withPresetAvailability } from '@/lib/preset-availability';

function cleanPreset(input: unknown): EvolvePreset | null {
  if (!input || typeof input !== 'object') return null;
  const rec = input as Record<string, unknown>;
  const name = typeof rec.name === 'string' ? rec.name.trim() : '';
  const harness = typeof rec.harness === 'string' ? rec.harness.trim() : '';
  const model = typeof rec.model === 'string' ? rec.model.trim() : '';
  const authSource = typeof rec.authSource === 'string' ? normalizeAuthSource(rec.authSource) : null;
  const id = typeof rec.id === 'string' && rec.id.startsWith('custom:') ? rec.id : `custom:${crypto.randomUUID()}`;
  if (!name || !harness || !model || !authSource) return null;
  return { id, name, harness, model, authSource };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const db = await getDb();
  const prefs = await db.getUserPreferences(user.id, [PREF_CUSTOM_PRESETS, PREF_DISABLED_BUILT_IN_PRESETS]);
  const storedAuthSources = new Set<string>();
  for (const authSource of SECRET_AUTH_SOURCES) {
    const stored = await db.getEncryptedCredential(user.id, authSource);
    if (stored) storedAuthSources.add(authSource);
  }
  return Response.json({
    builtInPresets: BUILT_IN_PRESETS.map((preset) => withPresetAvailability(preset, storedAuthSources)),
    customPresets: parseCustomPresets(prefs[PREF_CUSTOM_PRESETS]).map((preset) => withPresetAvailability(preset, storedAuthSources)),
    disabledBuiltInPresetIds: parseDisabledBuiltInPresetIds(prefs[PREF_DISABLED_BUILT_IN_PRESETS]),
  });
}

export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const rec = body && typeof body === 'object' ? body as Record<string, unknown> : null;
  const raw = rec && Array.isArray(rec.customPresets) ? rec.customPresets : null;
  const disabledRaw = rec && Array.isArray(rec.disabledBuiltInPresetIds) ? rec.disabledBuiltInPresetIds : [];
  if (!raw) return Response.json({ error: 'customPresets array required' }, { status: 400 });

  const customPresets = raw.map(cleanPreset);
  if (customPresets.some((p) => !p)) return Response.json({ error: 'Each preset needs name, authSource, harness, and model' }, { status: 400 });

  const disabledBuiltInPresetIds = parseDisabledBuiltInPresetIds(JSON.stringify(disabledRaw));

  const db = await getDb();
  await db.setUserPreferences(user.id, {
    [PREF_CUSTOM_PRESETS]: serializeCustomPresets(customPresets as EvolvePreset[]),
    [PREF_DISABLED_BUILT_IN_PRESETS]: serializeDisabledBuiltInPresetIds(disabledBuiltInPresetIds),
  });
  const storedAuthSources = new Set<string>();
  for (const authSource of SECRET_AUTH_SOURCES) {
    const stored = await db.getEncryptedCredential(user.id, authSource);
    if (stored) storedAuthSources.add(authSource);
  }
  return Response.json({
    customPresets: (customPresets as EvolvePreset[]).map((preset) => withPresetAvailability(preset, storedAuthSources)),
    disabledBuiltInPresetIds,
  });
}
