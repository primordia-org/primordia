// app/api/evolve/upstream-sync/route.ts
// Merge the parent branch into the session branch's worktree.

import { getSessionUser } from '@/lib/auth';
import { updateThread } from '@/lib/threads';

/** JSON body for POST /evolve/upstream-sync */
export interface EvolveUpstreamSyncBody {
  sessionId: string; // The thread id to sync upstream changes into.
  action: 'merge'; // The sync strategy. Currently only 'merge' is supported.
}

/**
 * Merge parent branch into a thread
 * @description Merges the thread's parent branch into the thread workspace to pick up upstream changes. Auto-resolves conflicts via Claude if needed.
 * @tag Evolve
 * @body EvolveUpstreamSyncBody
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const body = (await request.json()) as { sessionId?: string; action?: string };
  if (!body.sessionId) return Response.json({ error: 'thread id is required' }, { status: 400 });
  if (body.action !== 'merge') return Response.json({ error: 'action must be "merge"' }, { status: 400 });

  const result = await updateThread({ userId: user.id, threadId: body.sessionId });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ outcome: result.outcome, log: result.log });
}
