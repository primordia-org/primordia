// app/api/evolve/followup/route.ts
// Accepts a follow-up request for an existing local evolve session.
// POST — submit a follow-up request for a session that is in "ready" state.
//   Body: multipart/form-data or JSON { sessionId: string; request: string; attachments?: File[] }
//   Returns: { ok: true }

import * as path from 'path';
import * as fs from 'fs';
import { getSessionUser } from '@/lib/auth';
import { followupThread } from '@/lib/threads';

/** Multipart form-data body for POST /evolve/followup */
export interface EvolveFollowupFormData {
  sessionId: string; // The session ID (git branch name) of the ready session to continue.
  request: string; // The follow-up change request text for Claude Code.
  presetId?: string; // Preset ID; billing source, harness, and model are resolved from this preset.
  primordiaAesKey?: string; // Optional localStorage primordia_aes_key JWK used by the worker to decrypt the selected stored secret.
  attachments?: string; // Optional additional file attachments to include in this follow-up run.
}

/**
 * Submit a follow-up evolve request
 * @description Send an additional change request to an already-ready evolve session. Accepts multipart/form-data (supports file attachments) or JSON `{ sessionId, request, primordiaAesKey? }`.
 * @tag Evolve
 * @contentType multipart/form-data
 * @body EvolveFollowupFormData
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Parse request body — supports both JSON (legacy) and multipart/form-data (with file attachments).
  let sessionId: string;
  let requestText: string;
  let presetId: string | undefined;
  let primordiaAesKey: string | null = null;
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
    const presetField = formData.get('presetId');
    if (typeof presetField === 'string' && presetField) presetId = presetField;
    const aesKeyField = formData.get('primordiaAesKey');
    if (typeof aesKeyField === 'string' && aesKeyField) primordiaAesKey = aesKeyField;

    const files = formData.getAll('attachments');
    if (files.length > 0) {
      const uploadDir = path.join('/tmp', `primordia-upload-${crypto.randomUUID()}`);
      fs.mkdirSync(uploadDir, { recursive: true });
      const usedNames = new Set<string>();
      for (const file of files) {
        if (!(file instanceof File) || file.size === 0) continue;
        const buffer = Buffer.from(await file.arrayBuffer());
        let safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
        // Deduplicate: append _1, _2, etc. if the name was already used
        if (usedNames.has(safeName)) {
          const ext = path.extname(safeName);
          const stem = safeName.slice(0, safeName.length - ext.length);
          let counter = 1;
          while (usedNames.has(`${stem}_${counter}${ext}`)) counter++;
          safeName = `${stem}_${counter}${ext}`;
        }
        usedNames.add(safeName);
        const filePath = path.join(uploadDir, safeName);
        fs.writeFileSync(filePath, buffer);
        savedAttachmentPaths.push(filePath);
      }
    }
  } else {
    const body = (await request.json()) as { sessionId?: string; request?: string; presetId?: string; primordiaAesKey?: string };
    if (!body.sessionId || typeof body.sessionId !== 'string') {
      return Response.json({ error: 'sessionId string required' }, { status: 400 });
    }
    if (!body.request || typeof body.request !== 'string') {
      return Response.json({ error: 'request string required' }, { status: 400 });
    }
    sessionId = body.sessionId;
    requestText = body.request;
    if (body.presetId) presetId = body.presetId;
    if (body.primordiaAesKey) primordiaAesKey = body.primordiaAesKey;
  }

  const result = await followupThread({
    userId: user.id,
    threadId: sessionId,
    requestText,
    presetId,
    primordiaAesKey,
    attachmentPaths: savedAttachmentPaths,
    runInBackground: true,
  });
  primordiaAesKey = null;

  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true });
}
