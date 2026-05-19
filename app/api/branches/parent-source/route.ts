// app/api/branches/parent-source/route.ts
// Stores the current user's branch parent metadata source preference.

import { getSessionUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  BRANCH_PARENT_SOURCES,
  PREF_BRANCH_PARENT_SOURCE,
  type BranchParentSource,
} from '@/lib/user-prefs';

export interface BranchParentSourceBody {
  source: BranchParentSource;
}

/**
 * Update branch parent source preference
 * @description Switches the current user's Branches page/evolve parent resolver between legacy git-config metadata and branch-marker commit trailers.
 * @tag Branches
 * @body BranchParentSourceBody
 */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = (await request.json()) as { source?: unknown };
  if (typeof body.source !== 'string' || !(BRANCH_PARENT_SOURCES as readonly string[]).includes(body.source)) {
    return Response.json({ error: 'source must be "git-config" or "branch-marker"' }, { status: 400 });
  }

  const db = await getDb();
  await db.setUserPreferences(user.id, {
    [PREF_BRANCH_PARENT_SOURCE]: body.source,
  });

  return Response.json({ source: body.source });
}
