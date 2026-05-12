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
  | 'CLAUDE_CODE_CREDENTIALS_JSON'
  | 'CHATGPT_SUBSCRIPTION_OAUTH';

type AuthSource =
  | 'anthropic-api-key'
  | 'openrouter-api-key'
  | 'openai-api-key'
  | 'gemini-api-key'
  | 'claude-subscription'
  | 'chatgpt-subscription';

const TYPE_BY_AUTH_SOURCE: Record<AuthSource, SecretType> = {
  'anthropic-api-key': 'ANTHROPIC_API_KEY',
  'openrouter-api-key': 'OPENROUTER_API_KEY',
  'openai-api-key': 'OPENAI_API_KEY',
  'gemini-api-key': 'GEMINI_API_KEY',
  'claude-subscription': 'CLAUDE_CODE_CREDENTIALS_JSON',
  'chatgpt-subscription': 'CHATGPT_SUBSCRIPTION_OAUTH',
};

function isAuthSource(value: string): value is AuthSource {
  return value in TYPE_BY_AUTH_SOURCE;
}

/**
 * List configured secrets
 * @description Returns the list of secret types that have stored ciphertext for the authenticated user. Used by devices after cross-device sync to update their local secrets presence index.
 * @tag Secrets
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const db = await getDb();
  const authSources = await db.listEncryptedCredentialSources(user.id);
  const types = authSources.filter(isAuthSource).map((source) => TYPE_BY_AUTH_SOURCE[source]);

  return Response.json({ types });
}
