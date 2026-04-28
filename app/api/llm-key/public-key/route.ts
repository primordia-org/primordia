// app/api/llm-key/public-key/route.ts
// Returns the server's ephemeral RSA-OAEP public key as JWK.
// Clients use this to encrypt their Anthropic API key before sending it
// in evolve / chat requests so the plaintext key is never in server logs.

import { getSessionUser } from '@/lib/auth';
import { getPublicKeyJwk } from '@/lib/llm-encryption';

/**
 * Get LLM key encryption public key
 * @description Returns the server's ephemeral RSA-OAEP public key as JWK. Use this to encrypt a user-supplied Anthropic API key client-side before sending it to evolve endpoints.
 * @tag Llm-key
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const publicKey = await getPublicKeyJwk();
  return Response.json({ publicKey });
}
