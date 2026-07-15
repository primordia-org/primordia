// app/api/evolve/manage/route.ts
// Accept or reject a local evolve session — API wrapper around lib/threads.

import { getSessionUser } from '@/lib/auth';
import { manageThread } from '@/lib/threads';

/** JSON body for POST /evolve/manage */
export interface EvolveManageBody {
  action: 'accept' | 'reject';
  threadId: string;
  /** Optional selected billing source for accept-time auto-fix/auto-commit workers. */
  authSource?: string;
  /** Optional localStorage primordia_aes_key JWK. Passed to type-fix and auto-commit workers as PRIMORDIA_AES_KEY. */
  primordiaAesKey?: string;
}

/**
 * Accept or reject a thread
 * @description POST to accept (deploy) or reject (discard) a ready thread. Requires `can_evolve` or `admin` role.
 * @tag Evolve
 * @body EvolveManageBody
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const body = (await request.json()) as { action?: string; threadId?: string; authSource?: string; primordiaAesKey?: string };
  if (body.action !== 'accept' && body.action !== 'reject') {
    return Response.json({ error: 'action must be "accept" or "reject"' }, { status: 400 });
  }
  if (!body.threadId) {
    return Response.json({ error: 'threadId is required' }, { status: 400 });
  }

  const result = await manageThread({
    userId: user.id,
    threadId: body.threadId,
    action: body.action,
    authSource: body.authSource,
    primordiaAesKey: body.primordiaAesKey,
  });

  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        stuckThreadId: result.stuckSessionId,
        stuckThreadBranch: result.stuckSessionBranch,
      },
      { status: result.status },
    );
  }

  return Response.json({ outcome: result.outcome });
}
