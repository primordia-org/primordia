// app/api/llm-key/encrypted-key/route.ts
// Stores and retrieves the AES-GCM encrypted API key ciphertext for the
// authenticated user. The server never sees the AES key — only the ciphertext.
//
// GET  → { ciphertext: string | null }
//   Returns the stored JSON payload { iv, ciphertext } or null if none set.
//
// POST body: { iv: string, ciphertext: string }
//   Stores the encrypted payload in user_preferences.
//
// DELETE
//   Removes the stored ciphertext from user_preferences.
//
// Auth required for all methods.

import { getSessionUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

const PREF_KEY = 'encrypted_api_key';

/**
 * Get stored encrypted API key
 * @description Returns the stored AES-GCM encrypted API key ciphertext for the authenticated user, or `null` if none is set.
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

/** JSON body for POST /llm-key/encrypted-key */
export interface EncryptedKeyBody {
  iv: string; // Base64-encoded AES-GCM initialisation vector.
  ciphertext: string; // Base64-encoded AES-GCM ciphertext of the Anthropic API key.
}

/**
 * Store an encrypted API key
 * @description Stores an AES-GCM encrypted Anthropic API key for the authenticated user. The server never sees the AES decryption key — only the ciphertext is persisted.
 * @tag Llm-key
 * @body EncryptedKeyBody
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
 * Delete stored encrypted API key
 * @description Removes the stored encrypted API key for the authenticated user.
 * @tag Llm-key
 */
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const db = await getDb();
  await db.setUserPreferences(user.id, { [PREF_KEY]: '' });

  return Response.json({ ok: true });
}
