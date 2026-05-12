// app/api/credential-encryption/public-key/route.ts
// Returns the server's ephemeral RSA-OAEP public key as JWK.
// Clients use this to wrap ephemeral AES keys for hybrid credential transmission.

import { getSessionUser } from '@/lib/auth';
import { getPublicKeyJwk } from '@/lib/llm-encryption';

/**
 * Get credential-encryption public key
 * @description Returns the server's ephemeral RSA-OAEP public key as JWK. Use this to wrap ephemeral AES keys for hybrid credential transmission.
 * @tag Credential-encryption
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const publicKey = await getPublicKeyJwk();
  return Response.json({ publicKey });
}
