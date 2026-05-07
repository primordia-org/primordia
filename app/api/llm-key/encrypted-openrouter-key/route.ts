// app/api/llm-key/encrypted-openrouter-key/route.ts
// Stores and retrieves the AES-GCM encrypted OpenRouter API key ciphertext for
// the authenticated user. Mirrors encrypted-key/route.ts with a separate
// preference key so Anthropic and OpenRouter keys never share storage.
//
// GET  → { ciphertext: string | null }
// POST body: { iv: string, ciphertext: string }
// DELETE
//
// Auth required for all methods.

import { getSessionUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

const PREF_KEY = 'encrypted_openrouter_api_key';

/**
 * Get stored encrypted OpenRouter API key
 * @description Returns the stored AES-GCM encrypted OpenRouter API key ciphertext for the authenticated user, or `null` if none is set.
 * @tag Llm-key
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const db = await getDb();
  const prefs = await db.getUserPreferences(user.id, [PREF_KEY]);
  const stored = prefs[PREF_KEY];
  const ciphertext = stored && stored.length > 0 ? stored : null;

  return Response.json({ ciphertext });
}

/** JSON body for POST /llm-key/encrypted-openrouter-key */
export interface EncryptedOpenRouterKeyBody {
  iv: string;
  ciphertext: string;
}

/**
 * Store an encrypted OpenRouter API key
 * @description Stores an AES-GCM encrypted OpenRouter API key for the authenticated user.
 * @tag Llm-key
 * @body EncryptedOpenRouterKeyBody
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as Record<string, unknown>).iv !== 'string' ||
    typeof (body as Record<string, unknown>).ciphertext !== 'string'
  ) {
    return Response.json({ error: 'iv and ciphertext strings required' }, { status: 400 });
  }

  const { iv, ciphertext } = body as { iv: string; ciphertext: string };

  const db = await getDb();
  await db.setUserPreferences(user.id, {
    [PREF_KEY]: JSON.stringify({ iv, ciphertext }),
  });

  return Response.json({ ok: true });
}

/**
 * Delete stored encrypted OpenRouter API key
 * @description Removes the stored encrypted OpenRouter API key for the authenticated user.
 * @tag Llm-key
 */
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const db = await getDb();
  await db.setUserPreferences(user.id, { [PREF_KEY]: '' });

  return Response.json({ ok: true });
}
