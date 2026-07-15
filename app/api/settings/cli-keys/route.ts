import { getSessionUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { publicRevokableAesKey } from '@/lib/cli-keys';

const SHORT_ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';
const DEFAULT_EXPIRES_IN_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EXPIRES_IN_MS = 366 * 24 * 60 * 60 * 1000;

function randomShortId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = '';
  for (const byte of bytes) out += SHORT_ID_ALPHABET[byte % SHORT_ID_ALPHABET.length];
  return out;
}

async function uniqueShortId(): Promise<string> {
  const db = await getDb();
  for (let i = 0; i < 20; i += 1) {
    const candidate = randomShortId();
    if (!(await db.getRevokableAesKey(candidate))) return candidate;
  }
  throw new Error('Could not allocate a unique CLI key id.');
}

function normalizeExpiresAt(value: unknown): number {
  const now = Date.now();
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return now + DEFAULT_EXPIRES_IN_MS;
  return Math.min(Math.max(parsed, now + 60_000), now + MAX_EXPIRES_IN_MS);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const db = await getDb();
  const keys = await db.listRevokableAesKeys(user.id, 'cli');
  return Response.json({ keys: keys.map(publicRevokableAesKey) });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const encryptedAesKey = typeof record.encryptedAesKey === 'string' ? record.encryptedAesKey : '';
  const signature = typeof record.signature === 'string' ? record.signature : '';
  if (!encryptedAesKey || !signature) {
    return Response.json({ error: 'encryptedAesKey and signature are required' }, { status: 400 });
  }

  const now = Date.now();
  const db = await getDb();
  const shortId = await uniqueShortId();
  await db.createRevokableAesKey({
    shortId,
    userId: user.id,
    version: 'v1',
    client: 'cli',
    scopes: Array.isArray(record.scopes) ? record.scopes.join(' ') : '',
    note: typeof record.note === 'string' && record.note.trim() ? record.note.trim().slice(0, 160) : null,
    encryptedAesKey,
    expiresAt: normalizeExpiresAt(record.expiresAt),
    signature,
    createdAt: now,
  });
  const created = await db.getRevokableAesKey(shortId);
  return Response.json({ key: created ? publicRevokableAesKey(created) : null });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { shortId?: string; expiresAt?: number } | null;
  if (!body?.shortId) return Response.json({ error: 'shortId required' }, { status: 400 });
  const db = await getDb();
  const existing = await db.getRevokableAesKey(body.shortId);
  if (!existing || existing.userId !== user.id || existing.client !== 'cli') return Response.json({ error: 'CLI key not found' }, { status: 404 });
  await db.updateRevokableAesKeyExpiration(user.id, body.shortId, normalizeExpiresAt(body.expiresAt));
  const updated = await db.getRevokableAesKey(body.shortId);
  return Response.json({ key: updated ? publicRevokableAesKey(updated) : null });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { shortId?: string } | null;
  if (!body?.shortId) return Response.json({ error: 'shortId required' }, { status: 400 });
  const db = await getDb();
  await db.deleteRevokableAesKey(user.id, body.shortId);
  return Response.json({ ok: true });
}
