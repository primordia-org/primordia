import { getSessionUser } from '@/lib/auth';
import { isSecretAuthSource } from '@/lib/presets';
import { getOrCreateCredentialServerPublicJwk, issueCredentialNonce, rotateCredentialServerKeyPair } from '@/lib/secret-derivation-server';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ source: string }> },
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const { source } = await params;
  if (!isSecretAuthSource(source)) return Response.json({ error: 'Unknown secret source' }, { status: 400 });
  return Response.json({ publicKey: await getOrCreateCredentialServerPublicJwk(user.id, source), nonce: issueCredentialNonce(user.id, source) });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ source: string }> },
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const { source } = await params;
  if (!isSecretAuthSource(source)) return Response.json({ error: 'Unknown secret source' }, { status: 400 });
  return Response.json({ publicKey: await rotateCredentialServerKeyPair(user.id, source) });
}
