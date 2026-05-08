// app/api/secrets/route.ts
// Lists all secret types that have stored ciphertext for the current user.
// Called by receiving devices after cross-device AES key adoption to sync
// their local secrets presence index with what's actually on the server.
//
// GET → { types: SecretType[] }

import { getSessionUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

type SecretType =
  | 'ANTHROPIC_API_KEY'
  | 'OPENROUTER_API_KEY'
  | 'OPENAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'CLAUDE_CODE_CREDENTIALS_JSON';

const SERVER_PREF_KEYS: Record<SecretType, string> = {
  ANTHROPIC_API_KEY: 'encrypted_api_key',
  OPENROUTER_API_KEY: 'encrypted_openrouter_api_key',
  OPENAI_API_KEY: 'encrypted_openai_api_key',
  GEMINI_API_KEY: 'encrypted_gemini_api_key',
  CLAUDE_CODE_CREDENTIALS_JSON: 'encrypted_credentials',
};

const ALL_TYPES = Object.keys(SERVER_PREF_KEYS) as SecretType[];

/**
 * List configured secrets
 * @description Returns the list of secret types that have stored ciphertext for the authenticated user. Used by devices after cross-device sync to update their local secrets presence index.
 * @tag Secrets
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const db = await getDb();
  const prefs = await db.getUserPreferences(
    user.id,
    ALL_TYPES.map((t) => SERVER_PREF_KEYS[t]),
  );

  const types = ALL_TYPES.filter((t) => {
    const val = prefs[SERVER_PREF_KEYS[t]];
    return val && val.length > 0;
  });

  return Response.json({ types });
}
