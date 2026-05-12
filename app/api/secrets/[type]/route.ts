// app/api/secrets/[type]/route.ts
// Unified storage for all user secrets (API keys and credentials).
// Each secret type is stored as an AES-GCM encrypted blob in encrypted_credentials.
// The server never sees the AES key — only the ciphertext.
//
// GET  → { ciphertext: string | null }
//   Returns the stored JSON payload { iv, ciphertext } or null if none is set.
//
// POST body: { iv: string, ciphertext: string }
//   Stores the encrypted payload in encrypted_credentials.
//
// DELETE
//   Removes the stored ciphertext from encrypted_credentials.
//
// Auth required for all methods.

import { getSessionUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { AUTH_SOURCE_BY_TYPE, isSecretType, type SecretType } from '@/lib/secret-types';

function resolveType(params: { type: string }): SecretType | null {
  return isSecretType(params.type) ? params.type : null;
}

/**
 * Get stored encrypted secret
 * @description Returns the stored AES-GCM encrypted ciphertext for the given secret type, or `null` if none is set.
 * @tag Secrets
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const type = resolveType(await params);
  if (!type) return Response.json({ error: 'Unknown secret type' }, { status: 400 });

  const db = await getDb();
  const stored = await db.getEncryptedCredential(user.id, AUTH_SOURCE_BY_TYPE[type]);
  const ciphertext = stored && stored.length > 0 ? stored : null;

  return Response.json({ ciphertext });
}

/** JSON body for POST /api/secrets/[type] */
export interface StoreSecretBody {
  iv: string; // Base64-encoded AES-GCM initialisation vector.
  ciphertext: string; // Base64-encoded AES-GCM ciphertext.
}

/**
 * Store an encrypted secret
 * @description Stores an AES-GCM encrypted secret for the authenticated user. The server never sees the AES decryption key — only the ciphertext is persisted.
 * @tag Secrets
 * @body StoreSecretBody
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const type = resolveType(await params);
  if (!type) return Response.json({ error: 'Unknown secret type' }, { status: 400 });

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
  await db.setEncryptedCredential(user.id, AUTH_SOURCE_BY_TYPE[type], JSON.stringify({ iv, ciphertext }));

  return Response.json({ ok: true });
}

/**
 * Delete stored encrypted secret
 * @description Removes the stored encrypted secret for the authenticated user.
 * @tag Secrets
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const type = resolveType(await params);
  if (!type) return Response.json({ error: 'Unknown secret type' }, { status: 400 });

  const db = await getDb();
  await db.deleteEncryptedCredential(user.id, AUTH_SOURCE_BY_TYPE[type]);

  return Response.json({ ok: true });
}
