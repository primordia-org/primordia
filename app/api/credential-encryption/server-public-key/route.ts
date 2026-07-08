import { getServerPublicJwk } from '@/lib/secret-derivation-server';

export async function GET() {
  return Response.json({ publicKey: await getServerPublicJwk() });
}
