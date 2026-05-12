// app/api/secrets/route.ts
// Lists all secret sources that have stored ciphertext for the current user.
// Called by receiving devices after cross-device AES key adoption to sync
// their local secrets presence index with what's actually on the server.
//
// GET → { sources: SecretAuthSource[] }

import { getSessionUser } from '@/lib/auth';
import { listUserSecretSources } from '@/lib/settings-page-data';

/**
 * List configured secrets
 * @description Returns the list of secret sources that have stored ciphertext for the authenticated user. Used by devices after cross-device sync to update their local secrets presence index.
 * @tag Secrets
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const sources = await listUserSecretSources(user.id);

  return Response.json({ sources });
}
