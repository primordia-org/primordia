// app/api/evolve/reset-stuck/route.ts
// Force-resets a session that is stuck in 'accepting' or 'fixing-types' state
// back to 'ready'. This happens when the server process is killed during an
// accept pipeline, leaving a `section_start:deploy` event with no subsequent
// `result` event — so `inferStatusFromEvents` permanently infers 'accepting'.
//
// POST
//   Body: { sessionId: string }
//   Returns: { ok: true } or { error: string }
//
// Requires: can_evolve or admin permission.

import { getSessionUser } from '../../../../lib/auth';
import { hasEvolvePermission } from '../../../../lib/auth';
import {
  appendSessionEvent,
  getSessionNdjsonPath,
  getSessionFromFilesystem,
} from '../../../../lib/session-events';
import { INSTALL_SH_PID_FILE } from '../manage/route';
import * as fs from 'fs';
import * as path from 'path';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const canEvolve = await hasEvolvePermission(user.id);
  if (!canEvolve) {
    return Response.json({ error: 'Evolve permission required' }, { status: 403 });
  }

  const body = (await request.json()) as { sessionId?: string };
  if (!body.sessionId || typeof body.sessionId !== 'string') {
    return Response.json({ error: 'sessionId string required' }, { status: 400 });
  }

  const repoRoot = process.cwd();
  const record = getSessionFromFilesystem(body.sessionId, repoRoot);
  if (!record) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  if (record.status !== 'accepting' && record.status !== 'fixing-types') {
    return Response.json(
      {
        error: `Session is not stuck (status: ${record.status}). Only 'accepting' and 'fixing-types' sessions can be force-reset.`,
      },
      { status: 409 },
    );
  }

  const ndjsonPath = getSessionNdjsonPath(record.worktreePath);
  if (!fs.existsSync(ndjsonPath)) {
    return Response.json({ error: 'Session log not found on disk' }, { status: 404 });
  }

  // Kill any running install.sh process before resetting so a subsequent
  // re-accept doesn't race a zombie install.sh that is still hanging.
  const installPidFile = path.join(record.worktreePath, INSTALL_SH_PID_FILE);
  if (fs.existsSync(installPidFile)) {
    try {
      const installPid = parseInt(fs.readFileSync(installPidFile, 'utf8').trim(), 10);
      if (!isNaN(installPid)) {
        try { process.kill(-installPid, 'SIGTERM'); } catch { /* already gone */ }
        try { process.kill(installPid, 'SIGTERM'); } catch { /* already gone */ }
        console.log(`[reset-stuck] sent SIGTERM to install.sh PID ${installPid} for session ${body.sessionId}`);
      }
    } catch { /* non-fatal */ }
    try { fs.unlinkSync(installPidFile); } catch { /* non-fatal */ }
  }

  // Also kill any running preview dev server — it was killed at the start of the
  // accept pipeline, but if the pipeline got stuck before that kill (e.g. an
  // earlier server-restart scenario), the proxy endpoint is idempotent so this
  // is always safe.
  if (process.env.REVERSE_PROXY_PORT) {
    try {
      await fetch(`http://127.0.0.1:${process.env.REVERSE_PROXY_PORT}/_proxy/preview/${body.sessionId}`, {
        method: 'DELETE',
      });
    } catch { /* proxy not running — dev server may already be gone */ }
  }

  // Write a result:error event — this makes inferStatusFromEvents return 'ready',
  // unblocking the session so it can be accepted, rejected, or followed up.
  appendSessionEvent(ndjsonPath, {
    type: 'result',
    subtype: 'error',
    message:
      `❌ Session force-reset by user. The ${record.status === 'accepting' ? 'deploy' : 'type-fix'} ` +
      `pipeline did not complete (the server may have been restarted during the operation). ` +
      `You can now accept, reject, or submit a follow-up request.`,
    ts: Date.now(),
  });

  console.log(`[reset-stuck] Reset session ${body.sessionId} from ${record.status} → ready`);

  return Response.json({ ok: true });
}
