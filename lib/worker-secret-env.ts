// lib/worker-secret-env.ts
// Worker-side AES-GCM decryption for secrets stored by lib/secrets-client.

interface StoredSecretPayload {
  iv: string;
  ciphertext: string;
}

interface DecryptedWorkerSecret {
  apiKey?: string;
  credentials?: string;
  chatGptOAuth?: string;
}

export async function decryptWorkerSecret(encryptedSecret: string | undefined, aesKeyJwkJson: string | undefined, authSource: string | null | undefined): Promise<DecryptedWorkerSecret> {
  if (!encryptedSecret || !aesKeyJwkJson || !authSource || authSource === 'exe-dev-gateway') return {};

  const jwk = JSON.parse(aesKeyJwkJson) as JsonWebKey;
  if (jwk.kty !== 'oct' || typeof jwk.k !== 'string') throw new Error('Invalid PRIMORDIA_AES_KEY');

  const payload = JSON.parse(encryptedSecret) as StoredSecretPayload;
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const plaintextBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.fromBase64(payload.iv) },
    key,
    Uint8Array.fromBase64(payload.ciphertext),
  );
  const plaintext = new TextDecoder().decode(plaintextBytes);

  if (authSource === 'claude-subscription') return { credentials: plaintext };
  if (authSource === 'chatgpt-subscription') return { chatGptOAuth: plaintext };
  return { apiKey: plaintext };
}
