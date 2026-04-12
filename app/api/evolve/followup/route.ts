// app/api/evolve/followup/route.ts
// Accepts a follow-up request for an existing local evolve session.
// POST — submit a follow-up request for a session that is in "ready" state.
//   Body: multipart/form-data or JSON { sessionId: string; request: string; attachments?: File[] }
//   Returns: { ok: true }

import * as path from 'path';
import * as fs from 'fs';
import { getSessionUser } from '../../../../lib/auth';
import {
  runFollowupInWorktree,
  type LocalSession,
} from '../../../../lib/evolve-sessions';
import {
  getSessionFromFilesystem,
} from '../../../../lib/session-events';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Parse request body — supports both JSON (legacy) and multipart/form-data (with file attachments).
  let sessionId: string;
  let requestText: string;
  const savedAttachmentPaths: string[] = [];

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const sidField = formData.get('sessionId');
    const reqField = formData.get('request');
    if (!sidField || typeof sidField !== 'string') {
      return Response.json({ error: 'sessionId string required' }, { status: 400 });
    }
    if (!reqField || typeof reqField !== 'string') {
      return Response.json({ error: 'request string required' }, { status: 400 });
    }
    sessionId = sidField;
    requestText = reqField;

    const files = formData.getAll('attachments');
    if (files.length > 0) {
      const uploadDir = path.join('/tmp', `primordia-upload-${crypto.randomUUID()}`);
      fs.mkdirSync(uploadDir, { recursive: true });
      for (const file of files) {
        if (!(file instanceof File) || file.size === 0) continue;
        const buffer = Buffer.from(await file.arrayBuffer());
        const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(uploadDir, safeName);
        fs.writeFileSync(filePath, buffer);
        savedAttachmentPaths.push(filePath);
      }
    }
  } else {
    const body = (await request.json()) as { sessionId?: string; request?: string };
    if (!body.sessionId || typeof body.sessionId !== 'string') {
      return Response.json({ error: 'sessionId string required' }, { status: 400 });
    }
    if (!body.request || typeof body.request !== 'string') {
      return Response.json({ error: 'request string required' }, { status: 400 });
    }
    sessionId = body.sessionId;
    requestText = body.request;
  }

  const repoRoot = process.cwd();
  const record = getSessionFromFilesystem(sessionId, repoRoot);
  if (!record) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  if (record.status !== 'ready') {
    return Response.json(
      { error: `Session is not in a state that accepts follow-up requests (current status: ${record.status})` },
      { status: 400 },
    );
  }

  // Build the LocalSession object from the filesystem record.
  const session: LocalSession = {
    id: record.id,
    branch: record.branch,
    worktreePath: record.worktreePath,
    status: record.status as LocalSession['status'],
    devServerStatus: 'running',
    port: record.port,
    previewUrl: record.previewUrl,
    request: record.request,
    createdAt: record.createdAt,
  };

  // Fire-and-forget — runFollowupInWorktree handles all state transitions and
  // error cases internally, writing events to the NDJSON log.
  void runFollowupInWorktree(session, requestText, repoRoot, 'running-claude', undefined, false, savedAttachmentPaths);

  return Response.json({ ok: true });
}
